<?php
declare(strict_types=1);

namespace Hrm\Steward;

use JsonException;
use RuntimeException;

final class ContinuationToken
{
    public const TTL_SECONDS = 86400;

    public static function issue(string $parentCapsuleId, string $secret, int $now, ?\Closure $randomBytes = null): array
    {
        if (!KnowledgeCapsule::validId($parentCapsuleId) || strlen($secret) < 32) {
            throw new RuntimeException('invalid_continuation_token');
        }
        $nonce = ($randomBytes ?? random_bytes(...))(32);
        if (!is_string($nonce) || strlen($nonce) !== 32) {
            throw new RuntimeException('continuation_token_random_failure');
        }
        $payload = self::base64UrlEncode(json_encode([
            'v' => 1,
            'parent_capsule_id' => $parentCapsuleId,
            'issued_at' => $now,
            'expires_at' => $now + self::TTL_SECONDS,
            'nonce' => self::base64UrlEncode($nonce),
        ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES));
        $signature = self::base64UrlEncode(hash_hmac('sha256', $payload, self::signingKey($secret), true));
        return ['token' => $payload . '.' . $signature, 'expires_at' => $now + self::TTL_SECONDS];
    }

    public static function verify(string $token, string $parentCapsuleId, string $secret, int $now): string
    {
        if (strlen($token) > 1000 || !KnowledgeCapsule::validId($parentCapsuleId) || substr_count($token, '.') !== 1) {
            throw new RuntimeException('invalid_continuation_token');
        }
        [$payload, $signature] = explode('.', $token, 2);
        $provided = self::base64UrlDecode($signature);
        $expected = hash_hmac('sha256', $payload, self::signingKey($secret), true);
        if ($provided === null || !hash_equals($expected, $provided)) {
            throw new RuntimeException('invalid_continuation_token');
        }
        $raw = self::base64UrlDecode($payload);
        try {
            $data = $raw === null ? null : json_decode($raw, true, flags: JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            $data = null;
        }
        if (!is_array($data)
            || ($data['v'] ?? null) !== 1
            || ($data['parent_capsule_id'] ?? null) !== $parentCapsuleId
            || !is_int($data['issued_at'] ?? null)
            || !is_int($data['expires_at'] ?? null)
            || !is_string($data['nonce'] ?? null)
            || self::base64UrlDecode($data['nonce']) === null
            || $data['expires_at'] - $data['issued_at'] !== self::TTL_SECONDS
            || $data['issued_at'] > $now + 60
            || $data['expires_at'] <= $now) {
            throw new RuntimeException('invalid_continuation_token');
        }
        return hash('sha256', $token);
    }

    private static function signingKey(string $secret): string
    {
        return hash_hmac('sha256', 'hrm-capsule-continuation-token-v1', $secret, true);
    }

    private static function base64UrlEncode(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }

    private static function base64UrlDecode(string $value): ?string
    {
        if ($value === '' || preg_match('/^[A-Za-z0-9_-]+$/', $value) !== 1) {
            return null;
        }
        $decoded = base64_decode(strtr($value, '-_', '+/') . str_repeat('=', (4 - strlen($value) % 4) % 4), true);
        return is_string($decoded) ? $decoded : null;
    }
}
