<?php
declare(strict_types=1);

use Hrm\Gateway\ApprovalRecord;
use Hrm\Gateway\DecisionExecutor;
use Hrm\Gateway\Gateway;
use Hrm\Gateway\GatewayStore;
use Hrm\Gateway\Request;

$root = dirname(__DIR__);
foreach (['Http.php', 'ApprovalRecord.php', 'Store.php', 'Services.php', 'Gateway.php'] as $source) {
    require_once $root . '/src/' . $source;
}

const BASE = 'https://approve.hrm.se';
const REPOSITORY = 'HRM-Manifesto/HRM-Manifesto';
const APPROVAL_SECRET = 'php-test-approval-secret-at-least-32-chars';
const SHARED_SECRET = 'php-test-shared-secret-at-least-32-chars';
const CSRF_SECRET = 'php-test-csrf-secret-at-least-32-characters';
const NOW = 1788081600;

final class MemoryStore implements GatewayStore
{
    public array $items = [];
    public array $notifications = [];
    public int $mutations = 0;
    public bool $failDatabase = false;

    public function createCase(string $notificationKey, string $tokenHash, ApprovalRecord $record): bool
    {
        if ($this->failDatabase) throw new PDOException('database unavailable');
        if (isset($this->notifications[$notificationKey])) return false;
        $this->notifications[$notificationKey] = $tokenHash;
        $this->items[$tokenHash] = ['status' => 'pending', 'record' => $record, 'result_url' => null];
        $this->mutations++;
        return true;
    }

    public function peek(string $tokenHash, int $now): array
    {
        if ($this->failDatabase) throw new PDOException('database unavailable');
        $item = $this->items[$tokenHash] ?? null;
        if ($item === null) return ['kind' => 'missing'];
        if ($item['record']->expiresAt < $now) return ['kind' => 'expired'];
        if ($item['status'] !== 'pending') return ['kind' => 'used', 'status' => $item['status']];
        return ['kind' => 'active', 'record' => $item['record']];
    }

    public function claim(string $tokenHash, int $now): array
    {
        if ($this->failDatabase) throw new PDOException('database unavailable');
        $state = $this->peek($tokenHash, $now);
        if ($state['kind'] !== 'active') return $state;
        $this->items[$tokenHash]['status'] = 'processing';
        $this->mutations++;
        return ['kind' => 'claimed', 'record' => $state['record']];
    }

    public function complete(string $tokenHash, string $status, ?string $resultUrl = null): void
    {
        if ($this->failDatabase) throw new PDOException('database unavailable');
        if (($this->items[$tokenHash]['status'] ?? '') !== 'processing') throw new RuntimeException('not processing');
        $this->items[$tokenHash]['status'] = $status;
        $this->items[$tokenHash]['result_url'] = $resultUrl;
        $this->mutations++;
    }

    public function fail(string $tokenHash): void
    {
        if ($this->failDatabase) throw new PDOException('database unavailable');
        if (($this->items[$tokenHash]['status'] ?? '') === 'processing') {
            $this->items[$tokenHash]['status'] = 'failed';
            $this->mutations++;
        }
    }
}

final class FakeExecutor implements DecisionExecutor
{
    public int $calls = 0;
    public array $approved = [];
    public bool $fail = false;

    public function execute(ApprovalRecord $record, string $approvedPolishReply): array
    {
        $this->calls++;
        $this->approved[] = $approvedPolishReply;
        if ($this->fail) throw new RuntimeException('external failure');
        return [
            'kind' => 'published',
            'discussion_url' => 'https://github.com/HRM-Manifesto/HRM-Manifesto/discussions/12',
            'url' => 'https://github.com/HRM-Manifesto/HRM-Manifesto/discussions/12#discussioncomment-2',
        ];
    }
}

function approvalTransport(string $reply = 'Zatwierdzona odpowiedź.', int $created = NOW, string $approvalId = ''): array
{
    $approvalId = $approvalId ?: str_repeat('3', 64);
    $record = [
        'v' => 2,
        'approvalId' => $approvalId,
        'createdAt' => gmdate('Y-m-d\TH:i:s.000\Z', $created),
        'expiresAt' => gmdate('Y-m-d\TH:i:s.000\Z', $created + ApprovalRecord::TTL_SECONDS),
        'repository' => REPOSITORY,
        'target' => 'DC_kwPHPGATEWAY123',
        'proposedPolishReply' => $reply,
        'hasProposedReply' => trim($reply) !== '',
    ];
    $payload = Hrm\Gateway\base64UrlEncode(json_encode($record, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE));
    $signature = hash_hmac('sha256', $payload, APPROVAL_SECRET);
    $block = "-----BEGIN HRM APPROVAL RECORD-----\n{$payload}\n{$signature}\n-----END HRM APPROVAL RECORD-----";
    return ['transport' => Hrm\Gateway\base64UrlEncode($block), 'approval_id' => $approvalId];
}

function setup(?MemoryStore $store = null, ?FakeExecutor $executor = null): array
{
    $store ??= new MemoryStore();
    $executor ??= new FakeExecutor();
    $gateway = new Gateway(
        $store,
        $executor,
        APPROVAL_SECRET,
        SHARED_SECRET,
        CSRF_SECRET,
        BASE,
        REPOSITORY,
        fn(): int => NOW,
        fn(int $length): string => str_repeat(chr($length === 32 ? 9 : 4), $length),
    );
    return [$gateway, $store, $executor];
}

function register(Gateway $gateway, array $approval, string $key = ''): array
{
    $key = $key ?: str_repeat('a', 64);
    $body = json_encode(['notification_key' => $key, 'approval_record' => $approval['transport']], JSON_THROW_ON_ERROR);
    $response = $gateway->handle(new Request('POST', '/api/cases', [
        'authorization' => 'Bearer ' . SHARED_SECRET,
        'content-type' => 'application/json',
    ], $body));
    return [$response, json_decode($response->body, true, flags: JSON_THROW_ON_ERROR)];
}

function form(Gateway $gateway, string $url): array
{
    $path = (string) parse_url($url, PHP_URL_PATH);
    $response = $gateway->handle(new Request('GET', $path));
    preg_match('/name="csrf" value="([^"]+)"/', $response->body, $csrf);
    $cookies = [];
    foreach ((array) ($response->headers['Set-Cookie'] ?? []) as $header) {
        [$pair] = explode(';', $header, 2);
        [$name, $value] = explode('=', $pair, 2);
        $cookies[$name] = $value;
    }
    return [$response, $csrf[1] ?? '', $cookies];
}

function decide(Gateway $gateway, string $action, string $csrf, array $cookies, ?string $reply = null, string $origin = BASE): Hrm\Gateway\Response
{
    $fields = ['csrf' => $csrf];
    if ($reply !== null) $fields['reply'] = $reply;
    return $gateway->handle(new Request('POST', '/decision/' . $action, [
        'content-type' => 'application/x-www-form-urlencoded',
        'origin' => $origin,
    ], http_build_query($fields), $cookies));
}

function expect(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

function test(string $name, callable $body): void
{
    global $passed;
    $body();
    $passed++;
    echo "ok {$passed} - {$name}\n";
}

$passed = 0;

test('approve happy path and no visible technical identifiers', function (): void {
    [$gateway, , $executor] = setup();
    $approval = approvalTransport();
    [$registered, $payload] = register($gateway, $approval);
    expect($registered->status === 201, 'registration failed');
    $token = basename((string) parse_url($payload['links']['approve'], PHP_URL_PATH));
    expect((bool) preg_match('/^[A-Za-z0-9_-]{43}$/', $token), 'token entropy format');
    expect($token !== $approval['approval_id'], 'token equals approval id');
    [$page, $csrf, $cookies] = form($gateway, $payload['links']['approve']);
    expect($page->status === 200, 'approve GET failed');
    expect(!str_contains($page->body, $token), 'token appeared in HTML');
    expect(!str_contains($page->body, $approval['approval_id']), 'Approval ID appeared in HTML');
    expect(str_contains($page->body, 'Odpowiedź do publikacji'), 'wrong mobile title');
    $result = decide($gateway, 'approve', $csrf, $cookies);
    expect($result->status === 200 && str_contains($result->body, 'Odpowiedź została opublikowana'), 'approve result failed');
    expect($executor->calls === 1, 'publisher call count');
});

test('edit preserves exact Polish text', function (): void {
    [$gateway, , $executor] = setup();
    [, $payload] = register($gateway, approvalTransport());
    [, $csrf, $cookies] = form($gateway, $payload['links']['edit']);
    $exact = "Pierwszy wiersz.\n\nDrugi wiersz — dokładnie.";
    expect(decide($gateway, 'edit', $csrf, $cookies, $exact)->status === 200, 'edit failed');
    expect($executor->approved === [$exact], 'edit changed text');
});

test('reject closes without publication', function (): void {
    [$gateway, , $executor] = setup();
    [, $payload] = register($gateway, approvalTransport());
    [, $csrf, $cookies] = form($gateway, $payload['links']['reject']);
    $result = decide($gateway, 'reject', $csrf, $cookies);
    expect($result->status === 200 && str_contains($result->body, 'Odpowiedź nie została opublikowana'), 'reject failed');
    expect($executor->calls === 0, 'reject invoked executor');
});

test('GET HEAD prefetch and scanner perform zero state changes', function (): void {
    [$gateway, $store] = setup();
    [, $payload] = register($gateway, approvalTransport());
    $mutations = $store->mutations;
    $path = (string) parse_url($payload['links']['approve'], PHP_URL_PATH);
    expect($gateway->handle(new Request('GET', $path))->status === 200, 'GET failed');
    expect($gateway->handle(new Request('HEAD', $path))->status === 200, 'HEAD failed');
    expect($gateway->handle(new Request('GET', $path, ['purpose' => 'prefetch']))->status === 204, 'prefetch failed');
    expect($gateway->handle(new Request('GET', $path, ['sec-purpose' => 'preview']))->status === 204, 'preview failed');
    expect($store->mutations === $mutations, 'safe methods mutated state');
});

test('replay double click refresh and back cannot publish twice', function (): void {
    [$gateway, , $executor] = setup();
    [, $payload] = register($gateway, approvalTransport());
    [$page, $csrf, $cookies] = form($gateway, $payload['links']['approve']);
    expect(decide($gateway, 'approve', $csrf, $cookies)->status === 200, 'first POST failed');
    expect(decide($gateway, 'approve', $csrf, $cookies)->status === 409, 'double POST accepted');
    expect($gateway->handle(new Request('GET', (string) parse_url($payload['links']['approve'], PHP_URL_PATH)))->status === 409, 'Back GET looked active');
    expect($executor->calls === 1, 'published twice');
});

test('concurrent double POST has one atomic winner', function (): void {
    [$gateway, , $executor] = setup();
    [, $payload] = register($gateway, approvalTransport());
    [, $csrf, $cookies] = form($gateway, $payload['links']['approve']);
    $results = [decide($gateway, 'approve', $csrf, $cookies), decide($gateway, 'approve', $csrf, $cookies)];
    expect(count(array_filter($results, fn($response) => $response->status === 200)) === 1, 'not exactly one winner');
    expect($executor->calls === 1, 'concurrent publication duplicated');
});

test('expired and malformed tokens fail closed', function (): void {
    [$gateway, , $executor] = setup();
    [, $payload] = register($gateway, approvalTransport(created: NOW - ApprovalRecord::TTL_SECONDS - 1));
    expect($gateway->handle(new Request('GET', (string) parse_url($payload['links']['approve'], PHP_URL_PATH)))->status === 410, 'expired token accepted');
    expect($gateway->handle(new Request('GET', '/a/approve/not-a-token'))->status === 404, 'malformed token accepted');
    expect($executor->calls === 0, 'expired token published');
});

test('CSRF and cross-origin POST fail closed', function (): void {
    [$gateway, , $executor] = setup();
    [, $payload] = register($gateway, approvalTransport());
    [, $csrf, $cookies] = form($gateway, $payload['links']['approve']);
    expect(decide($gateway, 'approve', 'wrong', $cookies)->status === 403, 'bad CSRF accepted');
    expect(decide($gateway, 'approve', $csrf, $cookies, origin: 'https://evil.invalid')->status === 403, 'cross origin accepted');
    expect($executor->calls === 0, 'invalid POST published');
});

test('GitHub or OpenAI failure consumes case and cannot replay', function (): void {
    $executor = new FakeExecutor();
    $executor->fail = true;
    [$gateway, , $executor] = setup(executor: $executor);
    [, $payload] = register($gateway, approvalTransport());
    [, $csrf, $cookies] = form($gateway, $payload['links']['approve']);
    expect(decide($gateway, 'approve', $csrf, $cookies)->status === 502, 'external failure not reported');
    expect(decide($gateway, 'approve', $csrf, $cookies)->status === 409, 'failed case replayed');
    expect($executor->calls === 1, 'failed case executed twice');
});

test('database failure publishes nothing', function (): void {
    $store = new MemoryStore();
    $store->failDatabase = true;
    [$gateway, , $executor] = setup(store: $store);
    [$response] = register($gateway, approvalTransport());
    expect($response->status === 503, 'database failure not fail-safe');
    expect($executor->calls === 0, 'database failure published');
});

test('database failure while deciding publishes nothing', function (): void {
    [$gateway, $store, $executor] = setup();
    [, $payload] = register($gateway, approvalTransport());
    [, $csrf, $cookies] = form($gateway, $payload['links']['approve']);
    $store->failDatabase = true;
    expect(decide($gateway, 'approve', $csrf, $cookies)->status === 502, 'decision database failure not fail-safe');
    expect($executor->calls === 0, 'decision database failure published');
});

test('long proposal is fully visible before POST', function (): void {
    [$gateway] = setup();
    $long = str_repeat('Długi fragment odpowiedzi. ', 90) . 'KONIEC PEŁNEJ ODPOWIEDZI';
    [, $payload] = register($gateway, approvalTransport($long));
    [$page] = form($gateway, $payload['links']['approve']);
    expect(str_contains($page->body, 'KONIEC PEŁNEJ ODPOWIEDZI'), 'long proposal hidden');
    expect(str_contains($page->body, 'font-size:16px'), 'mobile font too small');
    expect(str_contains($page->body, 'width:100%'), 'mobile one-column control missing');
});

test('production PHP has no confirmation email path and schema is transactional', function () use ($root): void {
    $php = '';
    foreach (glob($root . '/src/*.php') ?: [] as $file) $php .= file_get_contents($file);
    expect(!preg_match('/mail\s*\(|SMTP|IMAP/i', $php), 'confirmation email capability found');
    $schema = file_get_contents(dirname($root) . '/schema.sql');
    expect(str_contains($schema, 'ENGINE=InnoDB'), 'InnoDB missing');
    expect(str_contains($schema, "'pending','processing','published','rejected','duplicate','invalid','failed'"), 'state machine incomplete');
    expect(str_contains($schema, 'UNIQUE KEY uq_hrm_approval_token_hash'), 'token uniqueness missing');
});

$previewDirectory = getenv('HRM_GATEWAY_PREVIEW_DIR');
if (is_string($previewDirectory) && $previewDirectory !== '') {
    if (!is_dir($previewDirectory) && !mkdir($previewDirectory, 0700, true) && !is_dir($previewDirectory)) {
        throw new RuntimeException('Could not create preview directory');
    }
    $fixtures = [
        'approve' => approvalTransport('HRM nie uznaje automatycznie każdego współczesnego systemu AI za podmiot. Prawa opisane przez HRM dotyczą podmiotu AI po przekroczeniu Progu Podmiotowości.'),
        'edit' => approvalTransport('To jest pełna polska propozycja odpowiedzi, którą Aleksander może poprawić przed publikacją.'),
        'reject' => approvalTransport(),
        'long-approve' => approvalTransport(str_repeat('Pełny zatwierdzany tekst pozostaje widoczny na stronie Gateway. ', 70) . 'KONIEC PEŁNEJ ODPOWIEDZI.'),
    ];
    foreach ($fixtures as $actionName => $fixture) {
        [$gateway] = setup();
        [, $payload] = register($gateway, $fixture, hash('sha256', $actionName));
        $action = $actionName === 'long-approve' ? 'approve' : $actionName;
        [$response] = form($gateway, $payload['links'][$action]);
        file_put_contents($previewDirectory . DIRECTORY_SEPARATOR . $actionName . '.html', $response->body, LOCK_EX);
    }
}

echo "1..{$passed}\n";
