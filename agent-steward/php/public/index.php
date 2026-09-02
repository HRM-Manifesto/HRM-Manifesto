<?php
declare(strict_types=1);

use Hrm\Steward\Application;
use Hrm\Steward\HttpsModerationGateway;
use Hrm\Steward\PdoStewardStore;
use Hrm\Steward\Request;
use Hrm\Steward\SourceCatalog;
use Hrm\Steward\StewardService;

ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

$root = dirname(__DIR__);
foreach (['Http.php', 'Store.php', 'Sources.php', 'GatewayClient.php', 'KnowledgeCapsule.php', 'ContinuationToken.php', 'StewardService.php', 'Application.php'] as $source) {
    require_once $root . '/src/' . $source;
}

try {
    $config = require $root . '/config.php';
    $sources = require $root . '/resources/sources.php';
    $card = json_decode((string) file_get_contents($root . '/resources/agent-card.json'), true, flags: JSON_THROW_ON_ERROR);
    if (!is_array($config) || !is_array($sources) || !is_array($card)) {
        throw new RuntimeException('Invalid configuration');
    }
    $store = PdoStewardStore::connect((array) ($config['database'] ?? []));
    $service = new StewardService(
        new SourceCatalog($sources),
        $store,
        new HttpsModerationGateway((string) ($config['approval_gateway_origin'] ?? ''), (string) ($config['approval_gateway_shared_secret'] ?? '')),
    );
    $application = new Application(
        $service,
        $store,
        (string) ($config['rate_limit_secret'] ?? ''),
        (string) ($config['moderation_callback_secret'] ?? ''),
        $card,
    );
    $request = Request::fromGlobals();
    $application->handle($request)->send($request->method === 'HEAD');
} catch (Throwable) {
    (new Hrm\Steward\Response(503, '{"error":{"code":503,"status":"UNAVAILABLE","message":"Service temporarily unavailable","details":[]}}', Hrm\Steward\securityHeaders('application/a2a+json; charset=utf-8')))->send();
}
