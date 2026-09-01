<?php
declare(strict_types=1);

use Hrm\Gateway\BoardCallbackClient;
use Hrm\Gateway\BoardGateway;
use Hrm\Gateway\PdoBoardCaseStore;
use Hrm\Gateway\Request;

ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

$prefix = '/board.php';
$requestUri = (string) ($_SERVER['REQUEST_URI'] ?? '/');
if ($requestUri === $prefix || str_starts_with($requestUri, $prefix . '/')) {
    $_SERVER['REQUEST_URI'] = substr($requestUri, strlen($prefix)) ?: '/';
}

$root = dirname(__DIR__);
foreach (['Http.php', 'BoardGateway.php'] as $source) {
    require_once $root . '/src/' . $source;
}

try {
    $config = require $root . '/config.php';
    $boardConfig = json_decode((string) file_get_contents($root . '/board-config.json'), true, flags: JSON_THROW_ON_ERROR);
    if (!is_array($config) || !is_array($boardConfig)) {
        throw new RuntimeException('Invalid Board configuration');
    }
    $request = Request::fromGlobals();
    $gateway = new BoardGateway(
        PdoBoardCaseStore::connect((array) ($boardConfig['database'] ?? [])),
        new BoardCallbackClient((string) ($boardConfig['steward_origin'] ?? ''), (string) ($boardConfig['moderation_callback_secret'] ?? '')),
        (string) ($boardConfig['gateway_shared_secret'] ?? ''),
        (string) ($boardConfig['notification_api_secret'] ?? ''),
        (string) ($boardConfig['notification_encryption_secret'] ?? ''),
        (string) ($boardConfig['csrf_secret'] ?? ''),
        (string) ($config['public_origin'] ?? ''),
    );
    $gateway->handle($request)->send($request->method === 'HEAD');
} catch (Throwable) {
    (new Hrm\Gateway\Response(503, Hrm\Gateway\page('Niedostępne', '<h1 style="font-size:22px">Usługa jest niedostępna.</h1>'), Hrm\Gateway\securityHeaders()))->send();
}
