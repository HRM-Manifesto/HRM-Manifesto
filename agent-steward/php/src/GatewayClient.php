<?php
declare(strict_types=1);

namespace Hrm\Steward;

use RuntimeException;

interface ModerationGateway
{
    public function register(array $submission): bool;
}

final class HttpsModerationGateway implements ModerationGateway
{
    public function __construct(
        private readonly string $origin,
        private readonly string $sharedSecret,
    ) {
        $parts = parse_url($origin);
        if (!is_array($parts) || ($parts['scheme'] ?? '') !== 'https' || empty($parts['host'])
            || strlen($sharedSecret) < 32 || preg_match('/[\r\n\0]/', $sharedSecret)) {
            throw new RuntimeException('Invalid moderation gateway configuration');
        }
    }

    public function register(array $submission): bool
    {
        $curl = curl_init(rtrim($this->origin, '/') . '/api/board-cases');
        if ($curl === false) {
            return false;
        }
        $body = json_encode($submission, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        curl_setopt_array($curl, [
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => [
                'Authorization: Bearer ' . $this->sharedSecret,
                'Content-Type: application/json',
                'Accept: application/json',
            ],
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => 12,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_USERAGENT => 'HRM-Public-Steward/1.0',
        ]);
        $response = curl_exec($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        curl_close($curl);
        if (!is_string($response) || $status < 200 || $status >= 300) {
            return false;
        }
        $decoded = json_decode($response, true);
        return is_array($decoded) && (($decoded['created'] ?? false) === true || ($decoded['created'] ?? null) === false);
    }
}
