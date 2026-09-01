<?php
declare(strict_types=1);

$entrypoint = __DIR__ . '/index.php';
clearstatcache(true, $entrypoint);
if (function_exists('opcache_invalidate')) {
    @opcache_invalidate($entrypoint, true);
}
require $entrypoint;
