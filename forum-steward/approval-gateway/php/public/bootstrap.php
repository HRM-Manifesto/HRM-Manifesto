<?php
declare(strict_types=1);

$bootstrapPrefix = '/bootstrap.php';
$requestUri = (string) ($_SERVER['REQUEST_URI'] ?? '/');
if ($requestUri === $bootstrapPrefix || str_starts_with($requestUri, $bootstrapPrefix . '/')) {
    $_SERVER['REQUEST_URI'] = substr($requestUri, strlen($bootstrapPrefix)) ?: '/';
}

$entrypoint = __DIR__ . '/index.php';
clearstatcache(true, $entrypoint);
if (function_exists('opcache_invalidate')) {
    @opcache_invalidate($entrypoint, true);
}
require $entrypoint;
