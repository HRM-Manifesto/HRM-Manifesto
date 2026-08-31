<?php
declare(strict_types=1);

namespace Hrm\Gateway;

use RuntimeException;
use Throwable;

final class Gateway
{
    private const TOKEN_PATTERN = '/^[A-Za-z0-9_-]{43}$/';
    private const NOTIFICATION_PATTERN = '/^[a-f0-9]{64}$/';

    public function __construct(
        private readonly GatewayStore $store,
        private readonly DecisionExecutor $executor,
        private readonly string $approvalSecret,
        private readonly string $sharedSecret,
        private readonly string $csrfSecret,
        private readonly string $publicOrigin,
        private readonly string $repository,
        private readonly ?\Closure $clock = null,
        private readonly ?\Closure $randomBytes = null,
    ) {
        foreach ([$approvalSecret, $sharedSecret, $csrfSecret] as $secret) {
            if (strlen($secret) < 32 || strlen($secret) > 10000 || preg_match('/[\r\n\0]/', $secret)) {
                throw new RuntimeException('Invalid gateway secret');
            }
        }
        $url = parse_url($publicOrigin);
        if (!is_array($url) || ($url['scheme'] ?? '') !== 'https' || empty($url['host'])
            || isset($url['user'], $url['pass'], $url['query'], $url['fragment'])
            || (($url['path'] ?? '') !== '' && ($url['path'] ?? '') !== '/')) {
            throw new RuntimeException('Gateway public URL must be a clean HTTPS origin');
        }
        if (!preg_match('/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/', $repository)) {
            throw new RuntimeException('Invalid gateway repository');
        }
    }

    public function handle(Request $request): Response
    {
        if ($request->method === 'POST' && $request->path === '/api/cases') {
            return $this->register($request);
        }
        if (preg_match('#^/a/(approve|edit|reject)/([A-Za-z0-9_-]{43})$#', $request->path, $match)) {
            return $this->showAction($request, $match[1], $match[2]);
        }
        if (preg_match('#^/decision/(approve|edit|reject)$#', $request->path, $match)) {
            return $this->decide($request, $match[1]);
        }
        return new Response(404, page('Nie znaleziono', '<h1 style="font-size:22px">Nie znaleziono</h1>'), securityHeaders());
    }

    private function register(Request $request): Response
    {
        $authorization = $request->header('authorization');
        if (!str_starts_with($authorization, 'Bearer ')
            || !hash_equals($this->sharedSecret, substr($authorization, 7))) {
            return $this->json(['error' => 'unauthorized'], 401);
        }
        try {
            $this->assertBodyLimit($request, 400000);
            if (!str_starts_with(strtolower($request->header('content-type')), 'application/json')) {
                throw new RuntimeException('Invalid content type');
            }
            $payload = json_decode($request->body, true, flags: JSON_THROW_ON_ERROR);
            $notificationKey = (string) ($payload['notification_key'] ?? '');
            $transport = (string) ($payload['approval_record'] ?? '');
            if (!preg_match(self::NOTIFICATION_PATTERN, $notificationKey)) {
                throw new RuntimeException('Invalid notification key');
            }
            $record = ApprovalRecord::fromTransport($transport, $this->approvalSecret, $this->repository);
            $token = base64UrlEncode(($this->randomBytes ?? random_bytes(...))(32));
            if (!preg_match(self::TOKEN_PATTERN, $token)) {
                throw new RuntimeException('Token generation failed');
            }
            $created = $this->store->createCase($notificationKey, hash('sha256', $token), $record);
            if (!$created) {
                return $this->json(['created' => false]);
            }
            $root = rtrim($this->publicOrigin, '/') . '/a';
            return $this->json([
                'created' => true,
                'links' => [
                    'approve' => $root . '/approve/' . $token,
                    'edit' => $root . '/edit/' . $token,
                    'reject' => $root . '/reject/' . $token,
                ],
            ], 201);
        } catch (Throwable $error) {
            if ($error instanceof \PDOException) {
                return $this->json(['error' => 'temporarily_unavailable'], 503);
            }
            return $this->json(['error' => 'invalid_case'], 400);
        }
    }

    private function showAction(Request $request, string $action, string $token): Response
    {
        $purpose = strtolower($request->header('purpose') . ' ' . $request->header('sec-purpose') . ' ' . $request->header('x-purpose'));
        if (in_array($request->method, ['GET', 'HEAD'], true) && (str_contains($purpose, 'prefetch') || str_contains($purpose, 'preview'))) {
            return new Response(204, '', securityHeaders());
        }
        if (!in_array($request->method, ['GET', 'HEAD'], true)) {
            return new Response(405, '', [...securityHeaders(), 'Allow' => 'GET, HEAD']);
        }
        try {
            $state = $this->store->peek(hash('sha256', $token), $this->now());
        } catch (Throwable) {
            return $this->safeFailure(503);
        }
        if (($state['kind'] ?? '') !== 'active') {
            return $this->unavailable((string) ($state['kind'] ?? 'missing'));
        }
        /** @var ApprovalRecord $record */
        $record = $state['record'];
        if ($action === 'approve' && !$record->hasProposedReply) {
            return $this->unavailable('invalid');
        }
        if ($request->method === 'HEAD') {
            return new Response(200, '', securityHeaders());
        }
        $csrf = $this->csrfValue($token, $action);
        $headers = securityHeaders();
        $headers['Set-Cookie'] = [
            'hrm_cap=' . $token . '; Path=/decision/; Max-Age=900; Secure; HttpOnly; SameSite=Strict',
            'hrm_csrf=' . $csrf . '; Path=/decision/; Max-Age=900; Secure; HttpOnly; SameSite=Strict',
        ];
        return new Response(200, $this->actionPage($action, $record, $csrf), $headers);
    }

    private function decide(Request $request, string $action): Response
    {
        if ($request->method !== 'POST') {
            return new Response(405, '', [...securityHeaders(), 'Allow' => 'POST']);
        }
        if (!hash_equals(rtrim($this->publicOrigin, '/'), $request->header('origin'))) {
            return $this->unavailable('invalid', 403);
        }
        $token = (string) ($request->cookies['hrm_cap'] ?? '');
        if (!preg_match(self::TOKEN_PATTERN, $token)) {
            return $this->unavailable('invalid', 403);
        }
        try {
            $this->assertBodyLimit($request, 20000);
            if (!str_starts_with(strtolower($request->header('content-type')), 'application/x-www-form-urlencoded')) {
                throw new RuntimeException('Invalid form content type');
            }
            parse_str($request->body, $form);
            $supplied = is_string($form['csrf'] ?? null) ? $form['csrf'] : '';
            $cookie = (string) ($request->cookies['hrm_csrf'] ?? '');
            if (!$this->verifyCsrf($supplied, $cookie, $token, $action)) {
                return $this->unavailable('invalid', 403);
            }
            $tokenHash = hash('sha256', $token);
            $claimed = $this->store->claim($tokenHash, $this->now());
            if (($claimed['kind'] ?? '') !== 'claimed') {
                return $this->unavailable((string) ($claimed['kind'] ?? 'used'));
            }
            /** @var ApprovalRecord $record */
            $record = $claimed['record'];
            if ($action === 'reject') {
                $this->store->complete($tokenHash, 'rejected');
                return $this->withExpiredCookies(new Response(200, $this->resultPage('rejected'), securityHeaders()));
            }
            $approved = $action === 'edit' ? (is_string($form['reply'] ?? null) ? $form['reply'] : '') : $record->proposedPolishReply;
            if (trim($approved) === '' || mb_strlen($approved, 'UTF-8') > ApprovalRecord::MAX_REPLY_CHARS) {
                $this->store->complete($tokenHash, 'invalid');
                return $this->unavailable('invalid', 422);
            }
            $outcome = $this->executor->execute($record, $approved);
            $kind = ($outcome['kind'] ?? '') === 'already_published' ? 'duplicate' : 'published';
            $resultUrl = is_string($outcome['url'] ?? null) ? $outcome['url'] : null;
            $this->store->complete($tokenHash, $kind, $resultUrl);
            $discussionUrl = is_string($outcome['discussion_url'] ?? null) ? $outcome['discussion_url'] : '';
            return $this->withExpiredCookies(new Response(200, $this->resultPage('published', $discussionUrl), securityHeaders()));
        } catch (Throwable) {
            if (isset($tokenHash)) {
                try {
                    $this->store->fail($tokenHash);
                } catch (Throwable) {
                    // Fail closed even if the database is unavailable.
                }
            }
            return $this->safeFailure(502);
        }
    }

    private function actionPage(string $action, ApprovalRecord $record, string $csrf): string
    {
        if ($action === 'approve') {
            $title = 'Odpowiedź do publikacji';
            $detail = '<h1 style="font-size:22px;line-height:1.25;margin:0 0 16px">Odpowiedź do publikacji</h1>'
                . '<div style="white-space:pre-wrap;overflow-wrap:anywhere;padding:16px;border:1px solid #a9b8b0;border-radius:6px;background:#fff">'
                . html($record->proposedPolishReply) . '</div>';
            $label = 'ZATWIERDŹ I OPUBLIKUJ';
            $color = '#185b43';
            $back = 'WRÓĆ';
        } elseif ($action === 'edit') {
            $title = 'Popraw odpowiedź';
            $detail = '<h1 style="font-size:22px;line-height:1.25;margin:0 0 16px">Popraw odpowiedź</h1>'
                . '<label for="reply" style="display:block;font-weight:700;margin-bottom:8px">Pełny tekst po polsku</label>'
                . '<textarea id="reply" name="reply" maxlength="8000" required style="box-sizing:border-box;width:100%;min-height:280px;padding:14px;'
                . 'border:1px solid #60756b;border-radius:6px;background:#fff;color:#17211d;font:16px/1.5 Arial,sans-serif">'
                . html($record->proposedPolishReply) . '</textarea>';
            $label = 'OPUBLIKUJ';
            $color = '#185b43';
            $back = 'ANULUJ';
        } else {
            $title = 'Nie odpowiadaj';
            $detail = '<h1 style="font-size:22px;line-height:1.25;margin:0 0 16px">Nie odpowiadaj</h1>'
                . '<p>Ta decyzja zamknie sprawę bez publikacji i bez użycia OpenAI.</p>';
            $label = 'ZAMKNIJ BEZ ODPOWIEDZI';
            $color = '#742c35';
            $back = 'ANULUJ';
        }
        $form = '<form method="post" action="/decision/' . $action . '" style="margin-top:18px">'
            . '<input type="hidden" name="csrf" value="' . html($csrf) . '">' . button($label, $color) . '</form>'
            . '<p style="margin-top:18px;text-align:center"><a href="https://www.hrm.se/" rel="noreferrer" '
            . 'style="display:inline-block;min-height:44px;line-height:44px;color:#164b3a;font-weight:700">' . $back . '</a></p>';
        return page($title, $detail . $form);
    }

    private function resultPage(string $kind, string $discussionUrl = ''): string
    {
        if ($kind === 'rejected') {
            return page('Sprawa zamknięta', '<h1 style="font-size:22px">Sprawa zamknięta.</h1><p>Odpowiedź nie została opublikowana.</p>');
        }
        $link = '';
        if ($discussionUrl !== '' && preg_match('#^https://github\.com/#', $discussionUrl)) {
            $link = '<p><a href="' . html($discussionUrl) . '" rel="noreferrer" style="display:block;box-sizing:border-box;min-height:52px;'
                . 'padding:13px 18px;border:2px solid #0f2f25;border-radius:6px;color:#164b3a;font-weight:700;text-align:center;text-decoration:none">'
                . 'OTWÓRZ DYSKUSJĘ</a></p>';
        }
        return page('Odpowiedź opublikowana', '<h1 style="font-size:22px">Odpowiedź została opublikowana.</h1>' . $link);
    }

    private function unavailable(string $kind, int $status = 409): Response
    {
        if ($kind === 'expired') {
            $status = 410;
            $message = 'Ten link wygasł. Odpowiedź nie została opublikowana.';
        } else {
            $message = 'Ta decyzja została już wykorzystana albo nie jest dostępna.';
        }
        return new Response($status, page('Decyzja niedostępna', '<h1 style="font-size:22px">Decyzja niedostępna</h1><p>' . $message . '</p>'), securityHeaders());
    }

    private function safeFailure(int $status): Response
    {
        return new Response($status, page('Nie opublikowano', '<h1 style="font-size:22px">Nie opublikowano odpowiedzi.</h1><p>Wystąpił bezpieczny błąd. Spróbuj ponownie tylko po sprawdzeniu stanu sprawy.</p>'), securityHeaders());
    }

    private function csrfValue(string $token, string $action): string
    {
        $nonce = base64UrlEncode(($this->randomBytes ?? random_bytes(...))(18));
        $expires = $this->now() + 900;
        $payload = $nonce . '.' . $expires . '.' . $action . '.' . hash('sha256', $token);
        return $nonce . '.' . $expires . '.' . base64UrlEncode(hash_hmac('sha256', $payload, $this->csrfSecret, true));
    }

    private function verifyCsrf(string $supplied, string $cookie, string $token, string $action): bool
    {
        if ($supplied === '' || $cookie === '' || !hash_equals($supplied, $cookie)) {
            return false;
        }
        $parts = explode('.', $supplied);
        if (count($parts) !== 3 || !preg_match('/^[A-Za-z0-9_-]{24}$/', $parts[0]) || !preg_match('/^\d{10}$/', $parts[1])) {
            return false;
        }
        if ((int) $parts[1] < $this->now()) {
            return false;
        }
        $payload = $parts[0] . '.' . $parts[1] . '.' . $action . '.' . hash('sha256', $token);
        $expected = base64UrlEncode(hash_hmac('sha256', $payload, $this->csrfSecret, true));
        return hash_equals($expected, $parts[2]);
    }

    private function assertBodyLimit(Request $request, int $maxBytes): void
    {
        $declared = (int) ($request->header('content-length') ?: 0);
        if ($declared > $maxBytes || strlen($request->body) > $maxBytes) {
            throw new RuntimeException('Request body is too large');
        }
    }

    private function json(array $payload, int $status = 200): Response
    {
        return new Response($status, json_encode($payload, JSON_THROW_ON_ERROR), securityHeaders('application/json; charset=utf-8'));
    }

    private function now(): int
    {
        return ($this->clock ?? time(...))();
    }

    private function withExpiredCookies(Response $response): Response
    {
        $headers = $response->headers;
        $headers['Set-Cookie'] = [
            'hrm_cap=; Path=/decision/; Max-Age=0; Secure; HttpOnly; SameSite=Strict',
            'hrm_csrf=; Path=/decision/; Max-Age=0; Secure; HttpOnly; SameSite=Strict',
        ];
        return new Response($response->status, $response->body, $headers);
    }
}
