<?php
declare(strict_types=1);

namespace Hrm\Gateway;

final class Request
{
    public function __construct(
        public readonly string $method,
        public readonly string $path,
        public readonly array $headers = [],
        public readonly string $body = '',
        public readonly array $cookies = [],
    ) {}

    public static function fromGlobals(): self
    {
        $headers = [];
        foreach ($_SERVER as $key => $value) {
            if (str_starts_with($key, 'HTTP_')) {
                $name = strtolower(str_replace('_', '-', substr($key, 5)));
                $headers[$name] = (string) $value;
            }
        }
        if (isset($_SERVER['CONTENT_TYPE'])) {
            $headers['content-type'] = (string) $_SERVER['CONTENT_TYPE'];
        }
        if (isset($_SERVER['CONTENT_LENGTH'])) {
            $headers['content-length'] = (string) $_SERVER['CONTENT_LENGTH'];
        }
        $uri = (string) ($_SERVER['REQUEST_URI'] ?? '/');
        return new self(
            strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')),
            (string) (parse_url($uri, PHP_URL_PATH) ?: '/'),
            $headers,
            (string) file_get_contents('php://input'),
            array_map('strval', $_COOKIE),
        );
    }

    public function header(string $name): string
    {
        return (string) ($this->headers[strtolower($name)] ?? '');
    }
}

final class Response
{
    public function __construct(
        public readonly int $status,
        public readonly string $body = '',
        public readonly array $headers = [],
    ) {}

    public function send(bool $headOnly = false): never
    {
        http_response_code($this->status);
        foreach ($this->headers as $name => $value) {
            foreach ((array) $value as $index => $item) {
                header($name . ': ' . $item, $index === 0);
            }
        }
        if (!$headOnly) {
            echo $this->body;
        }
        exit;
    }
}

function securityHeaders(string $contentType = 'text/html; charset=utf-8'): array
{
    return [
        'Cache-Control' => 'no-store, max-age=0',
        'Content-Security-Policy' => "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
        'Content-Type' => $contentType,
        'Cross-Origin-Opener-Policy' => 'same-origin',
        'Permissions-Policy' => 'camera=(), microphone=(), geolocation=(), payment=()',
        'Referrer-Policy' => 'no-referrer',
        'X-Content-Type-Options' => 'nosniff',
        'X-Frame-Options' => 'DENY',
    ];
}

function html(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function page(string $title, string $content): string
{
    return '<!doctype html><html lang="pl"><head><meta charset="utf-8">'
        . '<meta name="viewport" content="width=device-width,initial-scale=1">'
        . '<title>' . html($title) . ' — HRM</title></head>'
        . '<body style="margin:0;background:#f4f1ea;color:#17211d;font-family:Arial,sans-serif;font-size:16px;line-height:1.55">'
        . '<main style="box-sizing:border-box;width:100%;max-width:640px;margin:0 auto;padding:24px 16px 40px">'
        . '<p style="margin:0 0 20px;font-size:20px;font-weight:700;letter-spacing:.08em">HRM</p>'
        . $content . '</main></body></html>';
}

function button(string $label, string $color = '#185b43'): string
{
    return '<button type="submit" style="box-sizing:border-box;width:100%;min-height:52px;margin:12px 0 0;padding:13px 18px;'
        . 'border:2px solid #0f2f25;border-radius:6px;background:' . html($color) . ';color:#fff;'
        . 'font:700 16px/1.25 Arial,sans-serif;cursor:pointer">' . html($label) . '</button>';
}
