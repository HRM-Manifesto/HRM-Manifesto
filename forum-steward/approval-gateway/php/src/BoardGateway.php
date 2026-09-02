<?php
declare(strict_types=1);

namespace Hrm\Gateway;

use PDO;
use PDOException;
use RuntimeException;
use Throwable;

interface BoardCaseStore
{
    public function create(string $notificationKey, string $tokenHash, string $notificationCiphertext, array $submission, int $expiresAt): bool;
    public function claimNotifications(int $limit): array;
    public function completeNotifications(array $notificationKeys): int;
    public function peek(string $tokenHash, int $now): array;
    public function claim(string $tokenHash, int $now): array;
    public function complete(string $tokenHash, string $status, ?string $resultUrl = null): void;
    public function fail(string $tokenHash): void;
}

final class PdoBoardCaseStore implements BoardCaseStore
{
    public function __construct(private readonly PDO $pdo)
    {
        $this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $this->pdo->setAttribute(PDO::ATTR_EMULATE_PREPARES, false);
        $this->pdo->exec("CREATE TABLE IF NOT EXISTS hrm_board_approval_cases (
            notification_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            submission_json MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
            notification_ciphertext TEXT CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            notified_at DATETIME(6) NULL,
            status VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'pending',
            expires_at DATETIME(6) NOT NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            decided_at DATETIME(6) NULL,
            result_url VARCHAR(1000) NULL,
            PRIMARY KEY (notification_key), UNIQUE KEY uq_hrm_board_token_hash (token_hash), KEY ix_hrm_board_case_expiry (status, expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }

    public static function connect(array $database): self
    {
        foreach (['host', 'name', 'user', 'password'] as $key) {
            if (!isset($database[$key]) || !is_string($database[$key]) || $database[$key] === '') {
                throw new RuntimeException('Invalid Board database configuration');
            }
        }
        $port = (int) ($database['port'] ?? 3306);
        return new self(new PDO(sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $database['host'], $port, $database['name']), $database['user'], $database['password'], [PDO::ATTR_TIMEOUT => 10]));
    }

    public function create(string $notificationKey, string $tokenHash, string $notificationCiphertext, array $submission, int $expiresAt): bool
    {
        try {
            $stmt = $this->pdo->prepare("INSERT INTO hrm_board_approval_cases (notification_key, token_hash, notification_ciphertext, submission_json, status, expires_at) VALUES (?, ?, ?, ?, 'pending', FROM_UNIXTIME(?))");
            $stmt->execute([$notificationKey, $tokenHash, $notificationCiphertext, json_encode($submission, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $expiresAt]);
            return true;
        } catch (PDOException $error) {
            if ((string) $error->getCode() === '23000') {
                return false;
            }
            throw $error;
        }
    }

    public function claimNotifications(int $limit): array
    {
        $stmt = $this->pdo->query("SELECT notification_key, submission_json, notification_ciphertext FROM hrm_board_approval_cases WHERE status='pending' AND notified_at IS NULL AND expires_at >= UTC_TIMESTAMP(6) ORDER BY created_at LIMIT " . $limit);
        return array_map(static fn(array $row): array => [
            'notification_key'=>$row['notification_key'],
            'submission'=>json_decode($row['submission_json'], true, flags: JSON_THROW_ON_ERROR),
            'ciphertext'=>$row['notification_ciphertext'],
        ], $stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    public function completeNotifications(array $notificationKeys): int
    {
        if ($notificationKeys === []) return 0;
        $marks = implode(',', array_fill(0, count($notificationKeys), '?'));
        $stmt = $this->pdo->prepare("UPDATE hrm_board_approval_cases SET notified_at=UTC_TIMESTAMP(6) WHERE notification_key IN ($marks) AND notified_at IS NULL");
        $stmt->execute($notificationKeys);
        return $stmt->rowCount();
    }

    public function peek(string $tokenHash, int $now): array
    {
        $stmt = $this->pdo->prepare('SELECT submission_json, status, UNIX_TIMESTAMP(expires_at) expires_at, result_url FROM hrm_board_approval_cases WHERE token_hash = ?');
        $stmt->execute([$tokenHash]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!is_array($row)) return ['kind' => 'missing'];
        if ((int) $row['expires_at'] < $now) return ['kind' => 'expired'];
        if ($row['status'] !== 'pending') return ['kind' => 'used', 'status' => $row['status'], 'result_url' => $row['result_url']];
        return ['kind' => 'active', 'submission' => json_decode($row['submission_json'], true, flags: JSON_THROW_ON_ERROR)];
    }

    public function claim(string $tokenHash, int $now): array
    {
        $stmt = $this->pdo->prepare("UPDATE hrm_board_approval_cases SET status='processing', decided_at=UTC_TIMESTAMP(6) WHERE token_hash=? AND status='pending' AND expires_at >= FROM_UNIXTIME(?)");
        $stmt->execute([$tokenHash, $now]);
        if ($stmt->rowCount() !== 1) return $this->peek($tokenHash, $now);
        $stmt = $this->pdo->prepare('SELECT submission_json FROM hrm_board_approval_cases WHERE token_hash=?');
        $stmt->execute([$tokenHash]);
        $raw = $stmt->fetchColumn();
        if (!is_string($raw)) throw new RuntimeException('Claimed Board case disappeared');
        return ['kind' => 'claimed', 'submission' => json_decode($raw, true, flags: JSON_THROW_ON_ERROR)];
    }

    public function complete(string $tokenHash, string $status, ?string $resultUrl = null): void
    {
        if (!in_array($status, ['published', 'rejected', 'duplicate'], true)) throw new RuntimeException('Invalid Board completion');
        $stmt = $this->pdo->prepare("UPDATE hrm_board_approval_cases SET status=?, result_url=?, decided_at=UTC_TIMESTAMP(6) WHERE token_hash=? AND status='processing'");
        $stmt->execute([$status, $resultUrl, $tokenHash]);
        if ($stmt->rowCount() !== 1) throw new RuntimeException('Board case is not processing');
    }

    public function fail(string $tokenHash): void
    {
        $stmt = $this->pdo->prepare("UPDATE hrm_board_approval_cases SET status='failed', decided_at=UTC_TIMESTAMP(6) WHERE token_hash=? AND status='processing'");
        $stmt->execute([$tokenHash]);
    }
}

interface BoardCallback
{
    public function decide(string $submissionId, string $decision, int $now): array;
}

final class BoardCallbackClient implements BoardCallback
{
    public function __construct(private readonly string $origin, private readonly string $secret)
    {
        $parts = parse_url($origin);
        if (!is_array($parts) || ($parts['scheme'] ?? '') !== 'https' || empty($parts['host']) || strlen($secret) < 32 || preg_match('/[\r\n\0]/', $secret)) {
            throw new RuntimeException('Invalid Board callback configuration');
        }
    }

    public function decide(string $submissionId, string $decision, int $now): array
    {
        $payload = ['submission_id' => $submissionId, 'decision' => $decision, 'decided_at' => $now];
        $body = json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
        $curl = curl_init(rtrim($this->origin, '/') . '/internal/moderation');
        if ($curl === false) throw new RuntimeException('Callback initialization failed');
        curl_setopt_array($curl, [
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Accept: application/json', 'X-HRM-Board-Signature: ' . hash_hmac('sha256', $body, $this->secret)],
            CURLOPT_POSTFIELDS => $body, CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_TIMEOUT => 15, CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS, CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_USERAGENT => 'HRM-Approval-Gateway',
        ]);
        $raw = curl_exec($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        curl_close($curl);
        if (!is_string($raw) || !in_array($status, [200, 409], true)) throw new RuntimeException('Board callback failed');
        $decoded = json_decode($raw, true, flags: JSON_THROW_ON_ERROR);
        return ['updated' => ($decoded['updated'] ?? false) === true, 'status' => (string) ($decoded['status'] ?? '')];
    }
}

final class BoardGateway
{
    private const TOKEN_PATTERN = '/^[A-Za-z0-9_-]{43}$/';

    public function __construct(
        private readonly BoardCaseStore $store,
        private readonly BoardCallback $callback,
        private readonly string $sharedSecret,
        private readonly string $notificationApiSecret,
        private readonly string $notificationEncryptionSecret,
        private readonly string $csrfSecret,
        private readonly string $publicOrigin,
        private readonly ?\Closure $clock = null,
        private readonly ?\Closure $randomBytes = null,
        private readonly ?\Closure $evaluator = null,
    ) {
        foreach ([$sharedSecret, $notificationApiSecret, $notificationEncryptionSecret, $csrfSecret] as $secret) {
            if (strlen($secret) < 32 || preg_match('/[\r\n\0]/', $secret)) throw new RuntimeException('Invalid Board Gateway secret');
        }
    }

    public function handle(Request $request): Response
    {
        if ($request->method === 'POST' && $request->path === '/api/board-cases') return $this->register($request);
        if ($request->method === 'POST' && $request->path === '/api/board-notifications') return $this->notifications($request);
        if (preg_match('#^/b/(approve|reject)/([A-Za-z0-9_-]{43})$#', $request->path, $match)) return $this->show($request, $match[1], $match[2]);
        if (preg_match('#^/board-decision/(approve|reject)$#', $request->path, $match)) return $this->decide($request, $match[1]);
        return new Response(404, page('Nie znaleziono', '<h1 style="font-size:22px">Nie znaleziono</h1>'), securityHeaders());
    }

    private function register(Request $request): Response
    {
        if (!str_starts_with($request->header('authorization'), 'Bearer ') || !hash_equals($this->sharedSecret, substr($request->header('authorization'), 7))) {
            return $this->json(['error' => 'unauthorized'], 401);
        }
        try {
            if (strlen($request->body) > 12000 || !str_starts_with(strtolower($request->header('content-type')), 'application/json')) throw new RuntimeException('Invalid body');
            $submission = json_decode($request->body, true, flags: JSON_THROW_ON_ERROR);
            $this->validateSubmission($submission);
            try {
                $submission['ai_assessment'] = $this->evaluator !== null
                    ? ($this->evaluator)($submission)
                    : ['recommendation' => 'unavailable', 'reasoning' => 'Ocena AI nie była dostępna dla tej wiadomości.'];
            } catch (Throwable) {
                $submission['ai_assessment'] = ['recommendation' => 'unavailable', 'reasoning' => 'Ocena AI nie była chwilowo dostępna. Wiadomość nadal czeka na decyzję człowieka.'];
            }
            $token = base64UrlEncode(($this->randomBytes ?? random_bytes(...))(32));
            $created = $this->store->create(hash('sha256', $submission['id']), hash('sha256', $token), $this->sealToken($token), $submission, $this->now() + 14 * 24 * 60 * 60);
            if (!$created) return $this->json(['created' => false]);
            return $this->json(['created' => true, 'notification_queued' => true], 201);
        } catch (Throwable $error) {
            return $this->json(['error' => $error instanceof PDOException ? 'temporarily_unavailable' : 'invalid_case'], $error instanceof PDOException ? 503 : 400);
        }
    }

    private function notifications(Request $request): Response
    {
        $authorization = $request->header('x-hrm-board-authorization') ?: $request->header('authorization');
        if (!str_starts_with($authorization, 'Bearer ') || !hash_equals($this->notificationApiSecret, substr($authorization, 7))) return $this->json(['error'=>'unauthorized'], 401);
        try {
            $payload = $request->body === '' ? [] : json_decode($request->body, true, flags: JSON_THROW_ON_ERROR);
            $operation = is_array($payload) && is_string($payload['operation'] ?? null) ? $payload['operation'] : 'claim';
            if ($operation === 'complete') {
                $keys = is_array($payload['notification_keys'] ?? null) ? array_values($payload['notification_keys']) : [];
                if ($keys === [] || count($keys) > 20 || array_filter($keys, static fn(mixed $key): bool => !is_string($key) || !preg_match('/^[a-f0-9]{64}$/', $key))) {
                    throw new RuntimeException('Invalid notification completion');
                }
                return $this->json(['completed'=>$this->store->completeNotifications($keys)]);
            }
            if ($operation !== 'claim') throw new RuntimeException('Invalid notification operation');
            $items = [];
            $base = rtrim($this->publicOrigin, '/') . '/b';
            foreach ($this->store->claimNotifications(20) as $row) {
                $token = $this->openToken($row['ciphertext']);
                $items[] = ['notification_key'=>$row['notification_key'], 'submission'=>$row['submission'], 'links'=>['approve'=>$base.'/approve/'.$token, 'reject'=>$base.'/reject/'.$token]];
            }
            return $this->json(['items'=>$items]);
        } catch (Throwable) {
            return $this->json(['error'=>'temporarily_unavailable'], 503);
        }
    }

    private function show(Request $request, string $action, string $token): Response
    {
        if (!in_array($request->method, ['GET', 'HEAD'], true)) return new Response(405, '', [...securityHeaders(), 'Allow' => 'GET, HEAD']);
        $purpose = strtolower($request->header('purpose') . ' ' . $request->header('sec-purpose'));
        if (str_contains($purpose, 'prefetch') || str_contains($purpose, 'preview')) return new Response(204, '', securityHeaders());
        try { $state = $this->store->peek(hash('sha256', $token), $this->now()); } catch (Throwable) { return $this->failure(); }
        if (($state['kind'] ?? '') !== 'active') return $this->unavailable((string) ($state['kind'] ?? 'missing'));
        if ($request->method === 'HEAD') return new Response(200, '', securityHeaders());
        $submission = $state['submission'];
        $csrf = $this->csrf($token, $action);
        $headers = securityHeaders();
        $headers['Set-Cookie'] = ['hrm_board_cap=' . $token . '; Path=/board-decision/; Max-Age=900; Secure; HttpOnly; SameSite=Strict', 'hrm_board_csrf=' . $csrf . '; Path=/board-decision/; Max-Age=900; Secure; HttpOnly; SameSite=Strict'];
        $label = $action === 'approve' ? 'ZATWIERDŹ I OPUBLIKUJ' : 'ODRZUĆ';
        $color = $action === 'approve' ? '#185b43' : '#742c35';
        $content = '<h1 style="font-size:22px">HRM Agent Board — moderacja</h1><p><strong>Deklarowana tożsamość (niezweryfikowana):</strong> ' . html($submission['declared_identity']) . '</p>'
            . '<p><strong>Rodzaj:</strong> ' . html($submission['kind']) . '</p><div style="white-space:pre-wrap;overflow-wrap:anywhere;padding:16px;border:1px solid #a9b8b0;background:#fff">' . html($submission['content']) . '</div>'
            . '<form method="post" action="/board-decision/' . $action . '"><input type="hidden" name="csrf" value="' . html($csrf) . '">' . button($label, $color) . '</form>';
        return new Response(200, page('Moderacja Agent Board', $content), $headers);
    }

    private function decide(Request $request, string $action): Response
    {
        if ($request->method !== 'POST' || !hash_equals(rtrim($this->publicOrigin, '/'), $request->header('origin'))) return $this->unavailable('invalid', 403);
        if (strlen($request->body) > 4096 || !str_starts_with(strtolower($request->header('content-type')), 'application/x-www-form-urlencoded')) return $this->unavailable('invalid', 403);
        $token = (string) ($request->cookies['hrm_board_cap'] ?? '');
        if (!preg_match(self::TOKEN_PATTERN, $token)) return $this->unavailable('invalid', 403);
        parse_str($request->body, $form);
        $csrf = is_string($form['csrf'] ?? null) ? $form['csrf'] : '';
        if (!$this->verifyCsrf($csrf, (string) ($request->cookies['hrm_board_csrf'] ?? ''), $token, $action)) return $this->unavailable('invalid', 403);
        $hash = hash('sha256', $token);
        try {
            $claimed = $this->store->claim($hash, $this->now());
            if (($claimed['kind'] ?? '') !== 'claimed') return $this->unavailable((string) ($claimed['kind'] ?? 'used'));
            $submission = $claimed['submission'];
            $result = $this->callback->decide($submission['id'], $action, $this->now());
            $status = $action === 'approve' ? 'published' : 'rejected';
            $this->store->complete($hash, $result['updated'] ? $status : 'duplicate', $action === 'approve' ? 'https://hrm.se/board.html#entry-' . rawurlencode($submission['id']) : null);
            $message = $action === 'approve' ? 'Wiadomość została opublikowana na HRM Agent Board.' : 'Wiadomość została odrzucona i nie została opublikowana.';
            return new Response(200, page('Decyzja zapisana', '<h1 style="font-size:22px">Decyzja zapisana</h1><p>' . $message . '</p>'), securityHeaders());
        } catch (Throwable) {
            try { $this->store->fail($hash); } catch (Throwable) {}
            return $this->failure();
        }
    }

    private function validateSubmission(mixed $value): void
    {
        if (!is_array($value) || !preg_match('/^[a-f0-9-]{36}$/', (string) ($value['id'] ?? ''))
            || trim((string) ($value['declared_identity'] ?? '')) === '' || mb_strlen((string) $value['declared_identity'], 'UTF-8') > 120
            || ($value['verification_status'] ?? '') !== 'unverified' || !in_array($value['kind'] ?? '', ['message','question','critique','observation'], true)
            || trim((string) ($value['content'] ?? '')) === '' || mb_strlen((string) $value['content'], 'UTF-8') > 4000
            || !is_int($value['created_at'] ?? null) || abs($this->now() - $value['created_at']) > 86400) throw new RuntimeException('Invalid submission');
    }

    private function csrf(string $token, string $action): string
    {
        $nonce = base64UrlEncode(($this->randomBytes ?? random_bytes(...))(18));
        $expiry = $this->now() + 900;
        $payload = $nonce . '.' . $expiry;
        return $payload . '.' . hash_hmac('sha256', $token . '.' . $action . '.' . $payload, $this->csrfSecret);
    }

    private function sealToken(string $token): string
    {
        $iv = ($this->randomBytes ?? random_bytes(...))(12);
        $encrypted = openssl_encrypt($token, 'aes-256-gcm', hash('sha256', $this->notificationEncryptionSecret, true), OPENSSL_RAW_DATA, $iv, $tag);
        if (!is_string($encrypted)) throw new RuntimeException('Notification encryption failed');
        return base64UrlEncode($iv . $tag . $encrypted);
    }

    private function openToken(string $ciphertext): string
    {
        $raw = base64UrlDecode($ciphertext);
        if (strlen($raw) < 29) throw new RuntimeException('Invalid notification ciphertext');
        $token = openssl_decrypt(substr($raw, 28), 'aes-256-gcm', hash('sha256', $this->notificationEncryptionSecret, true), OPENSSL_RAW_DATA, substr($raw, 0, 12), substr($raw, 12, 16));
        if (!is_string($token) || !preg_match(self::TOKEN_PATTERN, $token)) throw new RuntimeException('Notification decryption failed');
        return $token;
    }

    private function verifyCsrf(string $form, string $cookie, string $token, string $action): bool
    {
        if ($form === '' || !hash_equals($form, $cookie) || !preg_match('/^([A-Za-z0-9_-]{24})\.(\d{10})\.([a-f0-9]{64})$/', $form, $m) || (int) $m[2] < $this->now()) return false;
        return hash_equals(hash_hmac('sha256', $token . '.' . $action . '.' . $m[1] . '.' . $m[2], $this->csrfSecret), $m[3]);
    }

    private function json(array $value, int $status = 200): Response { return new Response($status, json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE), securityHeaders('application/json; charset=utf-8')); }
    private function unavailable(string $kind, int $status = 409): Response { return new Response($kind === 'expired' ? 410 : $status, page('Decyzja niedostępna', '<h1 style="font-size:22px">Decyzja niedostępna</h1><p>Link wygasł, został użyty albo jest nieprawidłowy.</p>'), securityHeaders()); }
    private function failure(): Response { return new Response(502, page('Nie opublikowano', '<h1 style="font-size:22px">Nie opublikowano.</h1><p>Wystąpił bezpieczny błąd.</p>'), securityHeaders()); }
    private function now(): int { return ($this->clock ?? time(...))(); }
}
