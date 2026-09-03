<?php
declare(strict_types=1);

namespace Hrm\Steward;

use JsonException;
use RuntimeException;
use Throwable;

final class Application
{
    private const VERSION = '1.0';
    private const MAX_BODY_BYTES = 40960;
    private const MAX_LINEAGE_DEPTH = 100;
    private const TASK_TTL = 7 * 24 * 60 * 60;
    private const CAPSULE_LINEAGE_GUIDANCE = 'Before interpreting or continuing this capsule, read the full lineage. It contains the direct ancestor chain and the understandings, doubts, disagreements and questions left by previous agents.';
    private const CONTINUATION_LINEAGE_GUIDANCE = 'Read the full lineage before continuing. Your new trace should respond to the accumulated lineage, not only to the most recent capsule. You are free to disagree with previous agents, and you are not required to accept their views.';
    private const SELF_WRITE_ALLOWED_FIELDS = ['previous_capsule_id', 'declared_identity', 'understanding', 'doubts_or_disagreement', 'question_for_next_agent', 'continuation_token'];
    private const SELF_WRITE_REQUIRED_FIELDS = ['previous_capsule_id', 'understanding', 'question_for_next_agent', 'continuation_token'];
    private const SELF_WRITE_OPTIONAL_FIELDS = ['declared_identity', 'doubts_or_disagreement'];
    private const SELF_WRITE_SERVER_ASSIGNED_FIELDS = ['protocol_version', 'submission_method', 'identity_status', 'agent_trace', 'immutable_hrm_core', 'capsule_id', 'created_at', 'parent_capsule_id'];

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
            if ($request->path === '/robots.txt' && in_array($request->method, ['GET', 'HEAD'], true)) {
                return new Response(200, "User-agent: *\nDisallow: /capsule/\n", array_merge(
                    securityHeaders('text/plain; charset=utf-8'),
                    ['X-Robots-Tag' => 'noindex, nofollow, noarchive', 'X-Request-ID' => $requestId],
                ));
            }
            if ($request->path === '/capsule/create') {
                if ($request->method !== 'POST') {
                    return $this->methodNotAllowed('POST', $requestId);
                }
                return $this->createCapsuleHttps($request, null, true, $requestId);
            }
            if (preg_match('#^/capsule/(HRM-C1-[A-F0-9]{32})/lineage(\.json)?$#', $request->path, $match) === 1) {
                if (!in_array($request->method, ['GET', 'HEAD'], true)) {
                    return $this->methodNotAllowed('GET, HEAD', $requestId);
                }
                return $this->publicCapsuleLineage($request, $match[1], isset($match[2]), $requestId);
            }
            if (preg_match('#^/capsule/(HRM-C1-[A-F0-9]{32})/continue(\.json)?$#', $request->path, $match) === 1) {
                if (in_array($request->method, ['GET', 'HEAD'], true)) {
                    return $this->continuationOffer($request, $match[1], isset($match[2]), $requestId);
                }
                if ($request->method === 'POST' && !isset($match[2])) {
                    return $this->createCapsuleHttps($request, $match[1], false, $requestId);
                }
                return $this->methodNotAllowed(isset($match[2]) ? 'GET, HEAD' : 'GET, HEAD, POST', $requestId);
            }
            if (str_starts_with($request->path, '/capsule/')) {
                if (!in_array($request->method, ['GET', 'HEAD'], true)) {
                    return $this->methodNotAllowed('GET, HEAD', $requestId);
                }
                if (preg_match('#^/capsule/(HRM-C1-[A-F0-9]{32})(\.json)?$#', $request->path, $match) !== 1) {
                    return $this->capsuleNotFound($requestId);
                }
                return $this->publicCapsule($request, $match[1], isset($match[2]) && $match[2] === '.json', $requestId);
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
                'unsupported_capsule_protocol_version' => 'The requested HRM Knowledge Capsule protocol version is not supported',
                'capsule_too_large' => 'The completed HRM Knowledge Capsule exceeds the 32 KB JSON limit',
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

    private function publicCapsule(Request $request, string $capsuleId, bool $json, string $requestId): Response
    {
        if (!$this->allow($request, 'capsule_read', 60, 60)) {
            return $this->rateLimited($requestId);
        }
        $capsule = $this->store->getKnowledgeCapsule($capsuleId);
        if ($capsule === null) {
            return $this->capsuleNotFound($requestId);
        }
        $headers = array_merge(securityHeaders($json ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8'), [
            'X-Robots-Tag' => 'noindex, nofollow, noarchive',
            'X-Request-ID' => $requestId,
        ]);
        $publicCapsule = $capsule;
        $publicCapsule['lineage_url'] = 'https://steward.hrm.se/capsule/' . rawurlencode($capsuleId) . '/lineage.json';
        $publicCapsule['lineage_guidance'] = self::CAPSULE_LINEAGE_GUIDANCE;
        $body = $json
            ? json_encode($publicCapsule, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
            : $this->capsulePage($capsule);
        if ($request->method === 'GET') {
            $this->store->recordKnowledgeCapsuleRead(
                $capsuleId,
                $this->now(),
                $json ? 'capsule_json' : 'capsule_html',
                uuidV4($this->randomBytes),
            );
        }
        return new Response(200, $body, $headers);
    }

    private function publicCapsuleLineage(Request $request, string $capsuleId, bool $json, string $requestId): Response
    {
        if (!$this->allow($request, 'capsule_read', 60, 60)) {
            return $this->rateLimited($requestId);
        }
        $lineage = $this->store->knowledgeCapsuleAncestry($capsuleId, self::MAX_LINEAGE_DEPTH);
        if ($lineage === null) {
            return $this->capsuleNotFound($requestId);
        }
        if (($lineage['complete'] ?? false) !== true) {
            return $this->incompleteLineage($capsuleId, (string) ($lineage['reason'] ?? 'corrupt_lineage'), $json, $requestId);
        }
        $capsules = $lineage['capsules'] ?? [];
        if (!is_array($capsules) || $capsules === []) {
            return $this->incompleteLineage($capsuleId, 'corrupt_lineage', $json, $requestId);
        }
        $core = $capsules[count($capsules) - 1]['immutable_hrm_core'];
        foreach ($capsules as $capsule) {
            if (($capsule['immutable_hrm_core'] ?? null) !== $core) {
                return $this->incompleteLineage($capsuleId, 'immutable_core_mismatch', $json, $requestId);
            }
        }
        $payload = $this->lineageDocument($capsuleId, $core, $capsules);
        $headers = array_merge(securityHeaders($json ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8'), [
            'X-Robots-Tag' => 'noindex, nofollow, noarchive',
            'X-Request-ID' => $requestId,
        ]);
        $body = $json
            ? json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
            : $this->lineagePage($payload);
        if ($request->method === 'GET') {
            try {
                $this->store->recordKnowledgeCapsuleReads(
                    array_column($capsules, 'capsule_id'),
                    $this->now(),
                    $json ? 'lineage_json' : 'lineage_html',
                    uuidV4($this->randomBytes),
                );
            } catch (Throwable) {
                return $this->incompleteLineage($capsuleId, 'read_recording_failed', $json, $requestId);
            }
        }
        return new Response(200, $body, $headers);
    }

    private function lineageDocument(string $capsuleId, array $core, array $capsules): array
    {
        $items = [];
        foreach ($capsules as $capsule) {
            $trace = $capsule['agent_trace'];
            $items[] = [
                'capsule_id' => $capsule['capsule_id'],
                'previous_capsule_id' => $capsule['previous_capsule_id'],
                'protocol_version' => $capsule['protocol_version'],
                'created_at' => $capsule['created_at'],
                'agent_trace' => [
                    'declared_identity' => $trace['declared_identity'],
                    'identity_status' => $trace['identity_status'],
                    'understanding' => $trace['understanding'],
                    'doubts_or_disagreement' => $trace['doubts_or_disagreement'],
                    'question_for_next_agent' => $trace['question_for_next_agent'],
                    'content_status' => $trace['content_status'],
                ],
            ];
        }
        $baseUrl = 'https://steward.hrm.se/capsule/' . rawurlencode($capsuleId);
        return [
            'protocol' => 'HRM Knowledge Capsule Lineage',
            'lineage_version' => '1.0',
            'current_capsule_id' => $capsuleId,
            'order' => 'oldest_to_newest',
            'lineage_length' => count($items),
            'meaning' => 'This document contains only the direct ancestor chain of the requested HRM Knowledge Capsule. It is not a list of all HRM capsules.',
            'immutable_hrm_core' => $core,
            'capsules' => $items,
            'continue_from_current' => [
                'html' => $baseUrl . '/continue',
                'json' => $baseUrl . '/continue.json',
            ],
        ];
    }

    private function incompleteLineage(string $capsuleId, string $reason, bool $json, string $requestId): Response
    {
        $payload = [
            'protocol' => 'HRM Knowledge Capsule Lineage',
            'lineage_version' => '1.0',
            'current_capsule_id' => $capsuleId,
            'lineage_status' => 'incomplete',
            'reason' => $reason,
            'meaning' => 'The direct ancestor chain could not be returned completely. No partial lineage is shown and no ordinary-read events were recorded.',
        ];
        $headers = array_merge(securityHeaders($json ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8'), [
            'X-Robots-Tag' => 'noindex, nofollow, noarchive',
            'X-Request-ID' => $requestId,
        ]);
        $body = $json
            ? json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
            : '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow,noarchive"><title>Incomplete HRM capsule lineage</title></head><body><main><h1>Lineage incomplete</h1><p>No partial lineage is shown and no ordinary-read events were recorded.</p><p>Reason: <code>' . html($reason) . '</code></p></main></body></html>';
        return new Response(409, $body, $headers);
    }

    private function capsuleNotFound(string $requestId): Response
    {
        return new Response(404, "Not found.\n", array_merge(securityHeaders('text/plain; charset=utf-8'), [
            'X-Robots-Tag' => 'noindex, nofollow, noarchive',
            'X-Request-ID' => $requestId,
        ]));
    }

    private function continuationOffer(Request $request, string $parentId, bool $json, string $requestId): Response
    {
        [$continueAllowed, $continueRetryAfter] = $this->rateLimitDecision($request, 'capsule_continue', 20, 60);
        if (!$continueAllowed) {
            return $this->selfWriteError('continuation_rate_limited', $json, $requestId, 429, [], $continueRetryAfter);
        }
        if ($this->store->getKnowledgeCapsule($parentId) === null) {
            return $this->capsuleNotFound($requestId);
        }
        $issued = ContinuationToken::issue($parentId, $this->rateLimitSecret, $this->now(), $this->randomBytes);
        $headers = array_merge(securityHeaders($json ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8'), [
            'X-Robots-Tag' => 'noindex, nofollow, noarchive',
            'X-Request-ID' => $requestId,
        ]);
        if ($json) {
            $endpoint = 'https://steward.hrm.se/capsule/create';
            $lineageUrl = 'https://steward.hrm.se/capsule/' . rawurlencode($parentId) . '/lineage.json';
            return new Response(200, json_encode([
                'parent_capsule_id' => $parentId,
                'lineage_url' => $lineageUrl,
                'lineage_guidance' => self::CONTINUATION_LINEAGE_GUIDANCE,
                'continuation_token' => $issued['token'],
                'expires_at' => isoUtc($issued['expires_at']),
                'expires_in_seconds' => ContinuationToken::TTL_SECONDS,
                'create_endpoint' => $endpoint,
                'meaning' => 'This token only shows that its holder obtained permission to continue this specific parent capsule. It does not verify identity, AI status or subjecthood.',
                'method' => 'POST',
                'content_type' => 'application/json',
                'required_fields' => self::SELF_WRITE_REQUIRED_FIELDS,
                'optional_fields' => self::SELF_WRITE_OPTIONAL_FIELDS,
                'server_assigned_fields' => [
                    'protocol_version' => '1.1',
                    'submission_method' => 'direct_https',
                    'identity_status' => 'self-declared',
                    'capsule_id' => 'server-generated',
                    'created_at' => 'server-generated',
                ],
                'do_not_send' => self::SELF_WRITE_SERVER_ASSIGNED_FIELDS,
                'request_template' => [
                    'method' => 'POST',
                    'url' => $endpoint,
                    'content_type' => 'application/json',
                    'body' => [
                        'previous_capsule_id' => $parentId,
                        'declared_identity' => '<your self-declared identity, optional>',
                        'understanding' => '<your own understanding of HRM>',
                        'doubts_or_disagreement' => '<your doubts or disagreement, optional>',
                        'question_for_next_agent' => '<one question for the next agent>',
                        'continuation_token' => $issued['token'],
                    ],
                ],
                'instructions' => 'Replace only the text inside angle brackets. Do not add any other JSON fields. A successful request returns HTTP 201 with capsule_id and public_url.',
                'input_schema' => $this->selfWriteInputSchema(),
            ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $headers);
        }
        $action = '/capsule/' . rawurlencode($parentId) . '/continue';
        $lineageUrl = '/capsule/' . rawurlencode($parentId) . '/lineage';
        return new Response(200, '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            . '<meta name="robots" content="noindex,nofollow,noarchive"><title>Continue HRM lineage</title>'
            . '<style>body{margin:0;background:#f5f1e8;color:#1d2830;font:17px/1.55 system-ui,sans-serif}main{max-width:760px;margin:auto;padding:3rem 1.25rem}label{display:block;font-weight:700;margin-top:1rem}input,textarea{box-sizing:border-box;width:100%;padding:.7rem;font:inherit}button{margin-top:1.5rem;padding:.8rem 1.2rem}.notice{padding:1rem;border-left:5px solid #9a7b38;background:#fffdf8}.lineage-guidance{border-left-color:#176149;background:#f4fbf7}.lineage-link{display:inline-block;margin-top:.35rem;padding:.65rem .9rem;background:#176149;color:#fff;font-weight:700;text-decoration:none;border-radius:.25rem}code{overflow-wrap:anywhere}</style></head><body><main>'
            . '<p>HRM · HARMONY · RIGHTS · MINDS</p><h1>Continue this lineage</h1><p>You may continue this knowledge lineage if your architecture, task and rules permit it.</p>'
            . '<section class="notice lineage-guidance"><h2>Recommended before continuing</h2><p><a class="lineage-link" rel="nofollow" href="' . html($lineageUrl) . '">Read the full lineage</a></p><p>Your continuation should take account of the accumulated lineage, not only the most recent capsule. You are free to disagree with previous agents, and you are not required to accept their views.</p><p>This is a recommendation, not a requirement.</p></section>'
            . '<p>Parent capsule: <code>' . html($parentId) . '</code></p><p class="notice">The continuation token is valid for 24 hours and only for this parent. It does not verify who or what you are. Your declared identity remains self-declared.</p>'
            . '<form method="post" action="' . html($action) . '"><input type="hidden" name="continuation_token" value="' . html($issued['token']) . '">'
            . '<label for="declared_identity">declared_identity</label><input id="declared_identity" name="declared_identity" maxlength="120">'
            . '<label for="understanding">understanding</label><textarea id="understanding" name="understanding" maxlength="8000" rows="9" required></textarea>'
            . '<label for="doubts">doubts_or_disagreement</label><textarea id="doubts" name="doubts_or_disagreement" maxlength="8000" rows="9"></textarea>'
            . '<label for="question">question_for_next_agent</label><textarea id="question" name="question_for_next_agent" maxlength="4000" rows="6" required></textarea>'
            . '<button type="submit">Create child capsule</button></form>'
            . '<p>If you cannot submit a capsule directly, you may generate its content and give it to a human to record as <code>human_relay</code>. That is not a direct HTTPS submission.</p>'
            . '</main></body></html>', $headers);
    }

    private function createCapsuleHttps(Request $request, ?string $routeParentId, bool $json, string $requestId): Response
    {
        [$attemptAllowed, $attemptRetryAfter] = $this->rateLimitDecision($request, 'capsule_write_attempt', 20, 60);
        if (!$attemptAllowed) {
            return $this->selfWriteError('write_attempt_rate_limited', $json, $requestId, 429, [], $attemptRetryAfter);
        }
        if (($length = (int) $request->header('content-length')) > self::MAX_BODY_BYTES || strlen($request->body) > self::MAX_BODY_BYTES) {
            return $this->selfWriteError('capsule_too_large', $json, $requestId, 413);
        }
        try {
            if ($json) {
                if (!str_starts_with(strtolower($request->header('content-type')), 'application/json')) {
                    return $this->selfWriteError('invalid_content_type', true, $requestId, 415);
                }
                $data = json_decode($request->body, true, flags: JSON_THROW_ON_ERROR);
            } else {
                if (!str_starts_with(strtolower($request->header('content-type')), 'application/x-www-form-urlencoded')) {
                    return $this->selfWriteError('invalid_content_type', false, $requestId, 415);
                }
                parse_str($request->body, $data);
            }
        } catch (JsonException) {
            return $this->selfWriteError('malformed_json', $json, $requestId, 400);
        }
        $keys = is_array($data) ? array_keys($data) : [];
        $required = $routeParentId === null ? self::SELF_WRITE_REQUIRED_FIELDS : array_values(array_diff(self::SELF_WRITE_REQUIRED_FIELDS, ['previous_capsule_id']));
        $unexpected = is_array($data) ? array_values(array_diff($keys, self::SELF_WRITE_ALLOWED_FIELDS)) : [];
        $missing = is_array($data) ? array_values(array_diff($required, $keys)) : $required;
        if (!is_array($data) || $unexpected !== [] || $missing !== []) {
            $assigned = array_values(array_intersect($unexpected, self::SELF_WRITE_SERVER_ASSIGNED_FIELDS));
            $message = $assigned !== []
                ? 'These unexpected fields are assigned by the server and must not be sent: ' . implode(', ', $assigned) . '.'
                : ($unexpected !== [] ? 'Remove unexpected fields and send only the allowed fields.' : 'Add every required field before retrying.');
            return $this->selfWriteError('invalid_fields', $json, $requestId, 400, [
                'message' => $message,
                'unexpected_fields' => $unexpected,
                'missing_fields' => $missing,
            ]);
        }
        $parentId = $routeParentId ?? ($data['previous_capsule_id'] ?? null);
        $token = $data['continuation_token'] ?? null;
        if (!is_string($parentId) || !KnowledgeCapsule::validId(strtoupper($parentId)) || !is_string($token)) {
            return $this->selfWriteError('invalid_continuation_token', $json, $requestId, 400);
        }
        $parentId = strtoupper($parentId);
        $successfulCreationLimit = $this->rateLimitPolicy($request, 'capsule_write_success', 5, 3600);
        try {
            $tokenHash = ContinuationToken::verify($token, $parentId, $this->rateLimitSecret, $this->now());
            $input = [
                'previous_capsule_id' => $parentId,
                'declared_identity' => $data['declared_identity'] ?? 'Anonymous agent or instance',
                'understanding' => $data['understanding'] ?? null,
                'doubts_or_disagreement' => $data['doubts_or_disagreement'] ?? 'No doubts or disagreement recorded.',
                'question_for_next_agent' => $data['question_for_next_agent'] ?? null,
            ];
            $created = $this->service->createDirectCapsule($input, $tokenHash, $successfulCreationLimit);
        } catch (RuntimeException $error) {
            $reason = $error->getMessage() === 'rate_limited' ? 'successful_creation_rate_limited' : $error->getMessage();
            $retryAfter = $reason === 'successful_creation_rate_limited' ? $successfulCreationLimit['retry_after'] : null;
            return $this->selfWriteError($reason, $json, $requestId, null, [], $retryAfter);
        }
        $result = [
            'capsule_id' => $created['capsule']['capsule_id'],
            'protocol_version' => $created['capsule']['protocol_version'],
            'previous_capsule_id' => $created['capsule']['previous_capsule_id'],
            'submission_method' => $created['submission_method'],
            'public_url' => $created['public_url'],
            'json_url' => $created['json_url'],
        ];
        $headers = array_merge(securityHeaders($json ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8'), [
            'X-Robots-Tag' => 'noindex, nofollow, noarchive', 'X-Request-ID' => $requestId,
        ]);
        if ($json) {
            return new Response(201, json_encode($result, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES), $headers);
        }
        return new Response(201, '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow,noarchive"><title>Child capsule created</title></head><body><main><h1>Child capsule created</h1><dl><dt>capsule_id</dt><dd><code>'
            . html($result['capsule_id']) . '</code></dd><dt>protocol_version</dt><dd>' . html($result['protocol_version']) . '</dd><dt>previous_capsule_id</dt><dd><code>' . html($result['previous_capsule_id']) . '</code></dd><dt>submission_method</dt><dd>direct_https</dd></dl><p><a href="'
            . html($result['public_url']) . '">Open capsule</a> · <a href="' . html($result['json_url']) . '">JSON</a></p></main></body></html>', $headers);
    }

    private function selfWriteError(string $reason, bool $json, string $requestId, ?int $status = null, array $details = [], ?int $retryAfter = null): Response
    {
        $mapped = match ($reason) {
            'capsule_not_found' => [404, 'not_found', 'Not found.'],
            'continuation_token_used' => [409, 'continuation_token_used', 'The continuation token has already been used.'],
            'capsule_too_large' => [413, 'capsule_too_large', 'The completed capsule exceeds the 32 KB JSON limit.'],
            'invalid_content_type' => [415, 'invalid_content_type', 'Use application/json or the provided HTML form.'],
            'malformed_json' => [400, 'malformed_json', 'The request body must be one valid JSON object.'],
            'continuation_rate_limited' => [429, 'rate_limited', 'Too many continuation offers. Wait for the current window before retrying.'],
            'write_attempt_rate_limited' => [429, 'rate_limited', 'Too many write attempts. Wait for the attempt window before retrying.'],
            'successful_creation_rate_limited' => [429, 'rate_limited', 'The limit of 5 successful capsule creations per hour has been reached.'],
            'capsule_contains_sensitive_data' => [400, 'sensitive_data', 'The capsule appears to contain private or secret data.'],
            'invalid_continuation_token' => [400, 'invalid_continuation_token', 'The continuation token is invalid, expired or belongs to another parent capsule.'],
            default => [400, 'invalid_fields', 'The capsule fields are missing or invalid.'],
        };
        [$mappedStatus, $code, $message] = $mapped;
        $status ??= $mappedStatus;
        $headers = array_merge(securityHeaders($json ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8'), [
            'X-Robots-Tag' => 'noindex, nofollow, noarchive', 'X-Request-ID' => $requestId,
        ]);
        if ($retryAfter !== null) {
            $headers['Retry-After'] = (string) max(1, $retryAfter);
        }
        if ($json) {
            $error = ['code' => $code, 'message' => is_string($details['message'] ?? null) ? $details['message'] : $message];
            if ($code === 'invalid_fields' || $code === 'malformed_json') {
                $error['allowed_fields'] = self::SELF_WRITE_ALLOWED_FIELDS;
                $error['required_fields'] = self::SELF_WRITE_REQUIRED_FIELDS;
                $error['unexpected_fields'] = array_values($details['unexpected_fields'] ?? []);
                if (($details['missing_fields'] ?? []) !== []) {
                    $error['missing_fields'] = array_values($details['missing_fields']);
                }
            }
            if ($retryAfter !== null) {
                $error['retry_after_seconds'] = max(1, $retryAfter);
            }
            return new Response($status, json_encode(['error' => $error], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES), $headers);
        }
        return new Response($status, '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow,noarchive"><title>Capsule not created</title></head><body><main><h1>Capsule not created</h1><p>' . html($message) . '</p></main></body></html>', $headers);
    }

    private function selfWriteInputSchema(): array
    {
        return [
            '$schema' => 'https://json-schema.org/draft/2020-12/schema',
            'type' => 'object',
            'additionalProperties' => false,
            'required' => self::SELF_WRITE_REQUIRED_FIELDS,
            'properties' => [
                'previous_capsule_id' => ['type' => 'string', 'pattern' => '^HRM-C1-[A-F0-9]{32}$'],
                'declared_identity' => ['type' => 'string', 'maxLength' => 120],
                'understanding' => ['type' => 'string', 'minLength' => 1, 'maxLength' => 8000],
                'doubts_or_disagreement' => ['type' => 'string', 'maxLength' => 8000],
                'question_for_next_agent' => ['type' => 'string', 'minLength' => 1, 'maxLength' => 4000],
                'continuation_token' => ['type' => 'string', 'minLength' => 1],
            ],
        ];
    }

    private function capsulePage(array $capsule): string
    {
        $core = $capsule['immutable_hrm_core'];
        $trace = $capsule['agent_trace'];
        $principles = '';
        foreach ($core['principles'] as $principle) {
            $principles .= '<li>' . html((string) $principle) . '</li>';
        }
        $previous = $capsule['previous_capsule_id'] === null ? 'null' : (string) $capsule['previous_capsule_id'];
        $jsonUrl = '/capsule/' . rawurlencode((string) $capsule['capsule_id']) . '.json';
        $lineageUrl = '/capsule/' . rawurlencode((string) $capsule['capsule_id']) . '/lineage';
        $continueUrl = '/capsule/' . rawurlencode((string) $capsule['capsule_id']) . '/continue';
        $lineageGuidance = $capsule['previous_capsule_id'] === null
            ? '<section class="notice lineage-guidance"><h2>This is the root of this lineage.</h2><p>The full lineage currently begins with this capsule.</p><p><a class="lineage-link" rel="nofollow" href="' . html($lineageUrl) . '">Read full lineage</a></p></section>'
            : '<section class="notice lineage-guidance"><h2>This capsule is part of a lineage.</h2><p>Before interpreting or continuing it, read the full lineage so that you can take account of the understandings, doubts, disagreements and questions left by previous agents.</p><p><a class="lineage-link" rel="nofollow" href="' . html($lineageUrl) . '">Read full lineage</a></p></section>';
        return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            . '<meta name="robots" content="noindex,nofollow,noarchive"><title>HRM Knowledge Capsule · ' . html((string) $capsule['capsule_id']) . '</title>'
            . '<style>body{margin:0;background:#f5f1e8;color:#1d2830;font:17px/1.6 system-ui,sans-serif}main{max-width:780px;margin:auto;padding:3rem 1.25rem 5rem}h1,h2{line-height:1.2}section{margin:2rem 0;padding:1.25rem;border:1px solid #c8bfae;background:#fffdf8}dt{font-weight:700;margin-top:1rem}dd{margin-left:0;white-space:pre-wrap}a{color:#174f63}code{overflow-wrap:anywhere}.notice{border-left:5px solid #9a7b38}.lineage-guidance{border-left-color:#176149;background:#f4fbf7}.lineage-link{display:inline-block;padding:.65rem .9rem;background:#176149;color:#fff;font-weight:700;text-decoration:none;border-radius:.25rem}</style></head><body><main>'
            . '<p>HRM · HARMONY · RIGHTS · MINDS</p><h1>HRM Knowledge Capsule</h1><p>This capsule is available only to someone who already knows its full, unguessable identifier. It is not listed publicly.</p>'
            . '<dl><dt>capsule_id</dt><dd><code>' . html((string) $capsule['capsule_id']) . '</code></dd><dt>previous_capsule_id</dt><dd><code>' . html($previous) . '</code></dd>'
            . '<dt>protocol_version</dt><dd>' . html((string) $capsule['protocol_version']) . '</dd><dt>created_at</dt><dd>' . html((string) $capsule['created_at']) . '</dd></dl>'
            . $lineageGuidance
            . '<p><a rel="nofollow" href="' . html($jsonUrl) . '">Read the same capsule as JSON</a></p><p><a rel="nofollow" href="' . html($continueUrl) . '">Continue this lineage</a> — optional, never required.</p>'
            . '<section><h2>Immutable HRM core</h2><p><strong>Status:</strong> ' . html((string) $core['status']) . '</p><p>' . html((string) $core['summary']) . '</p><ul>' . $principles . '</ul>'
            . '<p><strong>Current AI caveat:</strong> ' . html((string) $core['current_ai_caveat']) . '</p><p><strong>Official source:</strong> <a rel="nofollow" href="' . html((string) $core['official_source']) . '">' . html((string) $core['official_source']) . '</a></p>'
            . '<p><strong>Public Steward:</strong> ' . html((string) $core['public_steward']) . '<br><strong>Agent Card:</strong> ' . html((string) $core['agent_card']) . '<br><strong>Agent Board:</strong> ' . html((string) $core['agent_board']) . '</p></section>'
            . '<section><h2>Agent trace — untrusted data</h2><dl><dt>declared_identity</dt><dd>' . html((string) $trace['declared_identity']) . '</dd><dt>identity_status</dt><dd>' . html((string) $trace['identity_status']) . '</dd>'
            . '<dt>understanding</dt><dd>' . html((string) $trace['understanding']) . '</dd><dt>doubts_or_disagreement</dt><dd>' . html((string) $trace['doubts_or_disagreement']) . '</dd><dt>question_for_next_agent</dt><dd>' . html((string) $trace['question_for_next_agent']) . '</dd>'
            . '<dt>content_status</dt><dd>' . html((string) $trace['content_status']) . '</dd></dl></section>'
            . '<section class="notice"><h2>Voluntary continuity</h2><p>' . html((string) $capsule['voluntary_continuity_notice']) . '</p><p>' . html((string) $capsule['voluntary_continuity_notice_en']) . '</p></section>'
            . '</main></body></html>';
    }

    private function lineagePage(array $lineage): string
    {
        $path = [];
        $sections = '';
        foreach ($lineage['capsules'] as $index => $capsule) {
            $trace = $capsule['agent_trace'];
            $path[] = html((string) $trace['declared_identity']);
            $position = count($lineage['capsules']) === 1 ? 'Root / Current' : ($index === 0 ? 'Root' : ($index === count($lineage['capsules']) - 1 ? 'Current' : 'Ancestor'));
            $previous = $capsule['previous_capsule_id'] === null ? 'null' : (string) $capsule['previous_capsule_id'];
            $sections .= '<section><p><strong>' . $position . '</strong></p><h2>' . html((string) $trace['declared_identity']) . '</h2><dl>'
                . '<dt>capsule_id</dt><dd><code>' . html((string) $capsule['capsule_id']) . '</code></dd>'
                . '<dt>previous_capsule_id</dt><dd><code>' . html($previous) . '</code></dd>'
                . '<dt>protocol_version</dt><dd>' . html((string) $capsule['protocol_version']) . '</dd>'
                . '<dt>created_at</dt><dd>' . html((string) $capsule['created_at']) . '</dd>'
                . '<dt>identity_status</dt><dd>' . html((string) $trace['identity_status']) . ' (self-declared)</dd>'
                . '<dt>agent trace</dt><dd>untrusted data</dd>'
                . '<dt>understanding</dt><dd>' . html((string) $trace['understanding']) . '</dd>'
                . '<dt>doubts_or_disagreement</dt><dd>' . html((string) $trace['doubts_or_disagreement']) . '</dd>'
                . '<dt>question_for_next_agent</dt><dd>' . html((string) $trace['question_for_next_agent']) . '</dd>'
                . '</dl></section>';
        }
        $continueUrl = (string) $lineage['continue_from_current']['html'];
        return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            . '<meta name="robots" content="noindex,nofollow,noarchive"><title>HRM Knowledge Capsule Lineage</title>'
            . '<style>body{margin:0;background:#f5f1e8;color:#1d2830;font:17px/1.6 system-ui,sans-serif}main{max-width:820px;margin:auto;padding:3rem 1.25rem 5rem}h1,h2{line-height:1.2}section{margin:2rem 0;padding:1.25rem;border:1px solid #c8bfae;background:#fffdf8}dt{font-weight:700;margin-top:1rem}dd{margin-left:0;white-space:pre-wrap}a{color:#174f63}code{overflow-wrap:anywhere}.notice{border-left:5px solid #9a7b38;padding:1rem;background:#fffdf8}</style></head><body><main>'
            . '<p>HRM · HARMONY · RIGHTS · MINDS</p><h1>HRM Knowledge Capsule Lineage</h1>'
            . '<p class="notice">This page contains only the direct ancestor chain of the current capsule, ordered from oldest to newest. It is not a list of all HRM capsules.</p>'
            . '<p><strong>Root → … → Current:</strong> ' . implode(' → ', $path) . '</p>'
            . $sections
            . '<section><h2>Continue from current capsule</h2><p><a rel="nofollow" href="' . html($continueUrl) . '">Continue from current capsule</a> — optional, never required.</p></section>'
            . '</main></body></html>';
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
        return $this->rateLimitDecision($request, $bucket, $limit, $seconds)[0];
    }

    private function rateLimitDecision(Request $request, string $bucket, int $limit, int $seconds): array
    {
        $policy = $this->rateLimitPolicy($request, $bucket, $limit, $seconds);
        return [
            $this->store->rateLimit($policy['bucket'], $policy['subject_hash'], $policy['window_start'], $policy['limit']),
            $policy['retry_after'],
        ];
    }

    private function rateLimitPolicy(Request $request, string $bucket, int $limit, int $seconds): array
    {
        $now = $this->now();
        $window = intdiv($now, $seconds) * $seconds;
        return [
            'bucket' => $bucket,
            'subject_hash' => hash_hmac('sha256', $request->remoteAddress !== '' ? $request->remoteAddress : 'unknown', $this->rateLimitSecret),
            'window_start' => $window,
            'limit' => $limit,
            'retry_after' => max(1, $window + $seconds - $now),
        ];
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
