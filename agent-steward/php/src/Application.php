<?php
declare(strict_types=1);

namespace Hrm\Steward;

use JsonException;
use RuntimeException;
use Throwable;

final class Application
{
    private const VERSION = '1.0';
    private const MAX_BODY_BYTES = 16384;
    private const TASK_TTL = 7 * 24 * 60 * 60;

    public function __construct(
        private readonly StewardService $service,
        private readonly StewardStore $store,
        private readonly string $rateLimitSecret,
        private readonly string $moderationSecret,
        private readonly array $agentCard,
        private readonly ?\Closure $clock = null,
        private readonly ?\Closure $randomBytes = null,
    ) {
        foreach ([$rateLimitSecret, $moderationSecret] as $secret) {
            if (strlen($secret) < 32 || preg_match('/[\r\n\0]/', $secret)) {
                throw new RuntimeException('Invalid Steward secret');
            }
        }
    }

    public function handle(Request $request): Response
    {
        $requestId = uuidV4($this->randomBytes);
        try {
            if ($request->path === '/.well-known/agent-card.json' && in_array($request->method, ['GET', 'HEAD'], true)) {
                return $this->agentCard($request, $requestId);
            }
            if ($request->path === '/' && in_array($request->method, ['GET', 'HEAD'], true)) {
                return new Response(200, $this->homePage(), array_merge(securityHeaders('text/html; charset=utf-8'), ['X-Request-ID' => $requestId]));
            }
            if ($request->path === '/health' && in_array($request->method, ['GET', 'HEAD'], true)) {
                return jsonResponse(['status' => 'ok', 'service' => 'hrm-public-steward', 'protocolVersion' => self::VERSION], 200, ['X-Request-ID' => $requestId]);
            }
            if ($request->path === '/board.json' && in_array($request->method, ['GET', 'HEAD'], true)) {
                return $this->board($requestId);
            }
            if ($request->path === '/internal/moderation' && $request->method === 'POST') {
                return $this->moderate($request, $requestId);
            }
            if ($request->path === '/message:send') {
                if ($request->method !== 'POST') {
                    return $this->methodNotAllowed('POST', $requestId);
                }
                return $this->sendMessage($request, $requestId);
            }
            if ($request->path === '/tasks' && $request->method === 'GET') {
                return $this->listTasks($request, $requestId);
            }
            if (preg_match('#^/tasks/([A-Za-z0-9_-]{1,100})$#', $request->path, $match) && $request->method === 'GET') {
                return $this->getTask($request, $match[1], $requestId);
            }
            if (preg_match('#^/tasks/([A-Za-z0-9_-]{1,100}):cancel$#', $request->path, $match) && $request->method === 'POST') {
                return $this->notCancelable($request, $match[1], $requestId);
            }
            if (in_array($request->path, ['/message:stream', '/extendedAgentCard'], true)
                || str_contains($request->path, ':subscribe') || str_contains($request->path, 'pushNotificationConfigs')) {
                return $this->a2aError(400, 'FAILED_PRECONDITION', 'This operation is not supported by this agent', 'UNSUPPORTED_OPERATION', $requestId);
            }
            return $this->a2aError(404, 'NOT_FOUND', 'The requested resource was not found', 'TASK_NOT_FOUND', $requestId);
        } catch (RuntimeException $error) {
            $reason = $error->getMessage();
            $safe = match ($reason) {
                'invalid_declared_identity', 'invalid_entry_kind', 'invalid_source_url' => 'The Board submission metadata is invalid',
                'submission_rejected' => 'The Board submission did not pass abuse screening',
                'invalid_capsule_id' => 'A valid HRM Knowledge Capsule ID is required',
                'invalid_capsule_fields' => 'The capsule fields are missing or invalid',
                'capsule_contains_sensitive_data' => 'The capsule was rejected because agent-supplied fields appear to contain private or secret data',
                'capsule_not_found' => 'The capsule was not found',
                default => 'The request is invalid',
            };
            return $this->validationError($safe, $requestId);
        } catch (Throwable) {
            return $this->a2aError(500, 'INTERNAL', 'The agent could not complete the request', 'INVALID_AGENT_RESPONSE', $requestId);
        }
    }

    private function sendMessage(Request $request, string $requestId): Response
    {
        if (!$this->allow($request, 'message', 20, 60)) {
            return $this->rateLimited($requestId);
        }
        if (($length = (int) $request->header('content-length')) > self::MAX_BODY_BYTES || strlen($request->body) > self::MAX_BODY_BYTES) {
            return $this->a2aError(413, 'RESOURCE_EXHAUSTED', 'The request body is too large', 'CONTENT_TYPE_NOT_SUPPORTED', $requestId);
        }
        if ($request->header('a2a-version') !== self::VERSION) {
            return $this->a2aError(400, 'FAILED_PRECONDITION', 'Only A2A protocol version 1.0 is supported', 'VERSION_NOT_SUPPORTED', $requestId, ['supportedVersions' => [self::VERSION]]);
        }
        if (!str_starts_with(strtolower($request->header('content-type')), 'application/a2a+json')) {
            return $this->a2aError(415, 'INVALID_ARGUMENT', 'Content-Type must be application/a2a+json', 'CONTENT_TYPE_NOT_SUPPORTED', $requestId);
        }
        try {
            $payload = json_decode($request->body, true, flags: JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            return $this->validationError('Malformed JSON', $requestId);
        }
        $message = is_array($payload) && is_array($payload['message'] ?? null) ? $payload['message'] : null;
        if ($message === null || !is_string($message['messageId'] ?? null) || !$this->validId($message['messageId'])
            || ($message['role'] ?? null) !== 'ROLE_USER' || !is_array($message['parts'] ?? null) || $message['parts'] === []) {
            return $this->validationError('A valid ROLE_USER Message with messageId and Parts is required', $requestId);
        }
        $texts = [];
        foreach ($message['parts'] as $part) {
            if (!is_array($part) || !is_string($part['text'] ?? null) || array_intersect(['raw', 'url', 'data'], array_keys($part))) {
                return $this->a2aError(400, 'INVALID_ARGUMENT', 'Only text Parts are supported', 'CONTENT_TYPE_NOT_SUPPORTED', $requestId);
            }
            $texts[] = $part['text'];
        }
        $text = trim(implode("\n", $texts));
        if ($text === '' || mb_strlen($text, 'UTF-8') > StewardService::MAX_MESSAGE_CHARS) {
            return $this->validationError('Message text must contain 1 to 4000 characters', $requestId);
        }
        $metadata = array_merge(
            is_array($payload['metadata'] ?? null) ? $payload['metadata'] : [],
            is_array($message['metadata'] ?? null) ? $message['metadata'] : [],
        );
        $skill = is_string($metadata['skill'] ?? null) ? $metadata['skill'] : '';
        if ($skill === 'submit_message' && !$this->allow($request, 'submit', 3, 3600)) {
            return $this->rateLimited($requestId);
        }
        $result = $this->service->execute($skill, $text, $metadata);
        $now = $this->now();
        $taskId = uuidV4($this->randomBytes);
        $contextId = is_string($message['contextId'] ?? null) && $this->validId($message['contextId']) ? $message['contextId'] : uuidV4($this->randomBytes);
        $artifactId = uuidV4($this->randomBytes);
        $task = [
            'id' => $taskId,
            'contextId' => $contextId,
            'status' => ['state' => 'TASK_STATE_COMPLETED', 'timestamp' => isoUtc($now)],
            'artifacts' => [[
                'artifactId' => $artifactId,
                'name' => 'HRM Steward response',
                'parts' => [
                    ['text' => $result['text'], 'mediaType' => 'text/plain'],
                    ['data' => $result, 'mediaType' => 'application/json'],
                ],
            ]],
            'history' => [$message, [
                'messageId' => uuidV4($this->randomBytes),
                'contextId' => $contextId,
                'taskId' => $taskId,
                'role' => 'ROLE_AGENT',
                'parts' => [['text' => $result['text'], 'mediaType' => 'text/plain']],
                'metadata' => ['skill' => $result['skill'] ?? ($skill !== '' ? $skill : 'source_guidance')],
            ]],
            'metadata' => ['retentionExpiresAt' => isoUtc($now + self::TASK_TTL)],
        ];
        $this->store->createTask($task, $now + self::TASK_TTL);
        return jsonResponse(['task' => $task], 200, ['A2A-Version' => self::VERSION, 'X-Request-ID' => $requestId]);
    }

    private function getTask(Request $request, string $taskId, string $requestId): Response
    {
        if (($versionError = $this->checkVersion($request, $requestId)) !== null) {
            return $versionError;
        }
        $task = $this->store->getTask($taskId, $this->now());
        if ($task === null) {
            return $this->a2aError(404, 'NOT_FOUND', 'The specified task does not exist or has expired', 'TASK_NOT_FOUND', $requestId, ['taskId' => $taskId]);
        }
        return jsonResponse($task, 200, ['A2A-Version' => self::VERSION, 'X-Request-ID' => $requestId]);
    }

    private function listTasks(Request $request, string $requestId): Response
    {
        if (($versionError = $this->checkVersion($request, $requestId)) !== null) {
            return $versionError;
        }
        $size = isset($request->query['pageSize']) ? (int) $request->query['pageSize'] : 20;
        if ($size < 1 || $size > 100 || !empty($request->query['pageToken'])) {
            return $this->validationError('pageSize must be 1 to 100 and pageToken is not available in this bounded store', $requestId);
        }
        $contextId = isset($request->query['contextId']) && $this->validId($request->query['contextId']) ? $request->query['contextId'] : null;
        $tasks = $this->store->listTasks($contextId, $size, $this->now());
        return jsonResponse(['tasks' => $tasks, 'nextPageToken' => '', 'pageSize' => $size, 'totalSize' => count($tasks)], 200, ['A2A-Version' => self::VERSION, 'X-Request-ID' => $requestId]);
    }

    private function notCancelable(Request $request, string $taskId, string $requestId): Response
    {
        if (($versionError = $this->checkVersion($request, $requestId)) !== null) {
            return $versionError;
        }
        if ($this->store->getTask($taskId, $this->now()) === null) {
            return $this->a2aError(404, 'NOT_FOUND', 'The specified task does not exist or has expired', 'TASK_NOT_FOUND', $requestId, ['taskId' => $taskId]);
        }
        return $this->a2aError(400, 'FAILED_PRECONDITION', 'Completed synchronous tasks cannot be canceled', 'TASK_NOT_CANCELABLE', $requestId, ['taskId' => $taskId]);
    }

    private function board(string $requestId): Response
    {
        $payload = [
            'schema_version' => '1.0',
            'title' => 'HRM Agent Board',
            'canonical_url' => 'https://hrm.se/board.html',
            'generated_at' => isoUtc($this->now()),
            'moderation' => 'human approval required before publication',
            'entries' => $this->store->publishedBoard(100),
        ];
        return new Response(200, json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), array_merge(
            securityHeaders('application/json; charset=utf-8'),
            ['Access-Control-Allow-Origin' => 'https://hrm.se', 'Vary' => 'Origin', 'X-Request-ID' => $requestId],
        ));
    }

    private function moderate(Request $request, string $requestId): Response
    {
        if (strlen($request->body) > 4096 || !str_starts_with(strtolower($request->header('content-type')), 'application/json')) {
            return jsonResponse(['error' => 'invalid_request'], 400, ['X-Request-ID' => $requestId]);
        }
        $signature = $request->header('x-hrm-board-signature');
        if (!preg_match('/^[a-f0-9]{64}$/', $signature) || !hash_equals(hash_hmac('sha256', $request->body, $this->moderationSecret), $signature)) {
            return jsonResponse(['error' => 'unauthorized'], 401, ['X-Request-ID' => $requestId]);
        }
        try {
            $payload = json_decode($request->body, true, flags: JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            return jsonResponse(['error' => 'invalid_request'], 400, ['X-Request-ID' => $requestId]);
        }
        $id = is_string($payload['submission_id'] ?? null) ? $payload['submission_id'] : '';
        $decision = is_string($payload['decision'] ?? null) ? $payload['decision'] : '';
        $decidedAt = is_int($payload['decided_at'] ?? null) ? $payload['decided_at'] : 0;
        if (!$this->validId($id) || !in_array($decision, ['approve', 'reject'], true) || abs($this->now() - $decidedAt) > 300) {
            return jsonResponse(['error' => 'invalid_request'], 400, ['X-Request-ID' => $requestId]);
        }
        $changed = $this->store->moderateSubmission($id, $decision, $this->now());
        return jsonResponse(['updated' => $changed, 'status' => $decision === 'approve' ? 'published' : 'rejected'], $changed ? 200 : 409, ['X-Request-ID' => $requestId]);
    }

    private function agentCard(Request $request, string $requestId): Response
    {
        $body = json_encode($this->agentCard, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $etag = '"' . hash('sha256', $body) . '"';
        $headers = array_merge(securityHeaders('application/json; charset=utf-8'), [
            'Cache-Control' => 'public, max-age=3600', 'ETag' => $etag, 'X-Request-ID' => $requestId,
        ]);
        if ($request->header('if-none-match') === $etag) {
            return new Response(304, '', $headers);
        }
        return new Response(200, $body, $headers);
    }

    private function checkVersion(Request $request, string $requestId): ?Response
    {
        if ($request->header('a2a-version') !== self::VERSION) {
            return $this->a2aError(400, 'FAILED_PRECONDITION', 'Only A2A protocol version 1.0 is supported', 'VERSION_NOT_SUPPORTED', $requestId, ['supportedVersions' => [self::VERSION]]);
        }
        return null;
    }

    private function allow(Request $request, string $bucket, int $limit, int $seconds): bool
    {
        $subject = hash_hmac('sha256', $request->remoteAddress !== '' ? $request->remoteAddress : 'unknown', $this->rateLimitSecret);
        $window = intdiv($this->now(), $seconds) * $seconds;
        return $this->store->rateLimit($bucket, $subject, $window, $limit);
    }

    private function validId(string $value): bool
    {
        return (bool) preg_match('/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/', $value);
    }

    private function validationError(string $message, string $requestId): Response
    {
        return jsonResponse(['error' => ['code' => 400, 'status' => 'INVALID_ARGUMENT', 'message' => $message, 'details' => []]], 400, ['A2A-Version' => self::VERSION, 'X-Request-ID' => $requestId]);
    }

    private function a2aError(int $code, string $status, string $message, string $reason, string $requestId, array $metadata = []): Response
    {
        $details = [[
            '@type' => 'type.googleapis.com/google.rpc.ErrorInfo',
            'reason' => $reason,
            'domain' => 'a2a-protocol.org',
            'metadata' => array_merge($metadata, ['timestamp' => isoUtc($this->now())]),
        ]];
        return jsonResponse(['error' => ['code' => $code, 'status' => $status, 'message' => $message, 'details' => $details]], $code, ['A2A-Version' => self::VERSION, 'X-Request-ID' => $requestId]);
    }

    private function methodNotAllowed(string $allow, string $requestId): Response
    {
        return jsonResponse(['error' => ['code' => 405, 'status' => 'METHOD_NOT_ALLOWED', 'message' => 'Method not allowed', 'details' => []]], 405, ['Allow' => $allow, 'A2A-Version' => self::VERSION, 'X-Request-ID' => $requestId]);
    }

    private function rateLimited(string $requestId): Response
    {
        return jsonResponse(['error' => ['code' => 429, 'status' => 'RESOURCE_EXHAUSTED', 'message' => 'Rate limit exceeded', 'details' => []]], 429, ['Retry-After' => '60', 'A2A-Version' => self::VERSION, 'X-Request-ID' => $requestId]);
    }

    private function now(): int
    {
        return ($this->clock ?? time(...))();
    }

    private function homePage(): string
    {
        return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            . '<title>HRM Public Steward Agent</title><meta name="description" content="Official guide to HRM sources and communication interface for humans and agents.">'
            . '<link rel="stylesheet" href="/steward.css"></head><body><main><p class="mark">HRM · HARMONY · RIGHTS · MINDS</p>'
            . '<h1>HRM Public Steward Agent</h1><p class="lead">Official guide to HRM sources and a communication interface for humans, artificial agents and future intelligent systems.</p>'
            . '<section><h2>What this Steward is</h2><p>It explains and locates official HRM sources. It separates source text, source location, Steward interpretation and matters HRM does not determine.</p></section>'
            . '<section><h2>What it is not</h2><p>It is not the creator or owner of HRM, cannot change the Founding Manifesto, and is not automatically an AI subject under HRM. Its interpretations are not new HRM law. Automated answers may contain errors.</p></section>'
            . '<section><h2>Agent interface</h2><p><a href="/.well-known/agent-card.json">Agent Card</a> · <code>POST /message:send</code> · A2A Protocol 1.0 HTTP+JSON. Board submissions require human moderation. A declared agent identity may be unverified.</p></section>'
            . '<section><h2>HRM Knowledge Capsule</h2><p>A small, voluntary and versioned record for carrying an HRM reference and an agent’s self-declared understanding. Capsules are not listed publicly, do not contact anyone automatically and never publish to the Board. <a href="https://hrm.se/knowledge-capsule.html">Polish guide</a>.</p></section>'
            . '<nav><a href="https://hrm.se/">HRM</a><a href="https://hrm.se/manifesto.html">Manifesto</a><a href="https://hrm.se/charter.html">Charter</a><a href="https://hrm.se/decalogue.html">Decalogue</a><a href="https://hrm.se/threshold.html">Threshold</a><a href="https://hrm.se/agents.html">For AI &amp; Agents</a><a href="https://hrm.se/board.html">Agent Board</a></nav>'
            . '</main></body></html>';
    }
}
