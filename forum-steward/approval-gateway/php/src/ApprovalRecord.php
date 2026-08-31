<?php
declare(strict_types=1);

namespace Hrm\Gateway;

use RuntimeException;

final class ApprovalRecord
{
    public const MAX_REPLY_CHARS = 8000;
    public const TTL_SECONDS = 14 * 24 * 60 * 60;

    public function __construct(
        public readonly string $repository,
        public readonly string $target,
        public readonly string $proposedPolishReply,
        public readonly bool $hasProposedReply,
        public readonly string $approvalHash,
        public readonly int $createdAt,
        public readonly int $expiresAt,
    ) {}

    public static function fromTransport(string $transport, string $secret, string $expectedRepository): self
    {
        if (strlen($secret) < 32 || strlen($secret) > 10000 || preg_match('/[\r\n\0]/', $secret)) {
            throw new RuntimeException('Invalid approval secret');
        }
        if (!preg_match('/^[A-Za-z0-9_-]{100,}$/', $transport)) {
            throw new RuntimeException('Invalid approval record transport');
        }
        $block = base64UrlDecode($transport);
        $pattern = '/-----BEGIN HRM APPROVAL RECORD-----\r?\n([A-Za-z0-9_-]+)\r?\n([a-f0-9]{64})\r?\n-----END HRM APPROVAL RECORD-----/';
        if (preg_match_all($pattern, $block, $matches) !== 1) {
            throw new RuntimeException('Missing or ambiguous approval record');
        }
        $payload = $matches[1][0];
        $supplied = $matches[2][0];
        $expected = hash_hmac('sha256', $payload, $secret);
        if (!hash_equals($expected, $supplied)) {
            throw new RuntimeException('Invalid approval signature');
        }
        $record = json_decode(base64UrlDecode($payload), true, flags: JSON_THROW_ON_ERROR);
        if (!is_array($record) || !in_array($record['v'] ?? null, [1, 2], true)) {
            throw new RuntimeException('Invalid approval record');
        }
        $expectedKeys = ['approvalId', 'createdAt', 'expiresAt', 'proposedPolishReply', 'repository', 'target', 'v'];
        if (($record['v'] ?? null) === 2) {
            $expectedKeys[] = 'hasProposedReply';
        }
        $actualKeys = array_keys($record);
        sort($actualKeys);
        sort($expectedKeys);
        if ($actualKeys !== $expectedKeys) {
            throw new RuntimeException('Invalid approval record fields');
        }
        $approvalId = (string) $record['approvalId'];
        $repository = (string) $record['repository'];
        $target = (string) $record['target'];
        $reply = (string) $record['proposedPolishReply'];
        if (!preg_match('/^[a-f0-9]{64}$/', $approvalId)
            || !preg_match('/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/', $repository)
            || strcasecmp($repository, $expectedRepository) !== 0
            || $target === '' || strlen($target) > 250 || preg_match('/[\r\n\0]/', $target)
            || mb_strlen($reply, 'UTF-8') > self::MAX_REPLY_CHARS) {
            throw new RuntimeException('Invalid approval record values');
        }
        $hasReply = trim($reply) !== '';
        if (($record['v'] ?? null) === 2 && (!is_bool($record['hasProposedReply']) || $record['hasProposedReply'] !== $hasReply)) {
            throw new RuntimeException('Invalid proposed reply flag');
        }
        $createdAt = strtotime((string) $record['createdAt']);
        $expiresAt = strtotime((string) $record['expiresAt']);
        if ($createdAt === false || $expiresAt === false || $expiresAt - $createdAt !== self::TTL_SECONDS) {
            throw new RuntimeException('Invalid approval validity');
        }
        return new self($repository, $target, $reply, $hasReply, hash('sha256', $approvalId), $createdAt, $expiresAt);
    }
}

function base64UrlDecode(string $value): string
{
    if (!preg_match('/^[A-Za-z0-9_-]+$/', $value)) {
        throw new RuntimeException('Invalid base64url value');
    }
    $padding = (4 - strlen($value) % 4) % 4;
    $decoded = base64_decode(strtr($value, '-_', '+/') . str_repeat('=', $padding), true);
    if ($decoded === false) {
        throw new RuntimeException('Invalid base64url encoding');
    }
    return $decoded;
}

function base64UrlEncode(string $value): string
{
    return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
}
