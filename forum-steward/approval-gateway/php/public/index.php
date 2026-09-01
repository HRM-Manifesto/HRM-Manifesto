<?php
declare(strict_types=1);

use Hrm\Gateway\ApprovalExecutor;
use Hrm\Gateway\BoardCallbackClient;
use Hrm\Gateway\BoardGateway;
use Hrm\Gateway\Gateway;
use Hrm\Gateway\GitHubAppClient;
use Hrm\Gateway\JsonHttpClient;
use Hrm\Gateway\OpenAiTranslator;
use Hrm\Gateway\PdoGatewayStore;
use Hrm\Gateway\PdoBoardCaseStore;
use Hrm\Gateway\Request;

ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

$root = dirname(__DIR__);
foreach (['Http.php', 'ApprovalRecord.php', 'Store.php', 'Services.php', 'Gateway.php', 'BoardGateway.php'] as $source) {
    require_once $root . '/src/' . $source;
}

$configFile = $root . '/config.php';
if (!is_file($configFile) || !is_readable($configFile)) {
    (new Hrm\Gateway\Response(503, Hrm\Gateway\page('Niedostępne', '<h1 style="font-size:22px">Usługa jest niedostępna.</h1>'), Hrm\Gateway\securityHeaders()))->send();
}

try {
    $config = require $configFile;
    $boardConfigFile = $root . '/board-config.php';
    $boardConfig = is_file($boardConfigFile) && is_readable($boardConfigFile) ? require $boardConfigFile : [];
    if (!is_array($config)) {
        throw new RuntimeException('Invalid configuration');
    }
    $http = new JsonHttpClient();
    $store = PdoGatewayStore::connect((array) ($config['database'] ?? []));
    $github = new GitHubAppClient(
        $http,
        (int) ($config['github_app_id'] ?? 0),
        (int) ($config['github_installation_id'] ?? 0),
        (string) ($config['github_private_key_path'] ?? ''),
        (string) ($config['repository'] ?? ''),
    );
    $translator = new OpenAiTranslator(
        $http,
        (string) ($config['openai_api_key'] ?? ''),
        (string) ($config['openai_model'] ?? ''),
    );
    $gateway = new Gateway(
        $store,
        new ApprovalExecutor($github, $translator),
        (string) ($config['approval_secret'] ?? ''),
        (string) ($config['gateway_shared_secret'] ?? ''),
        (string) ($config['csrf_secret'] ?? ''),
        (string) ($config['public_origin'] ?? ''),
        (string) ($config['repository'] ?? ''),
    );
    $request = Request::fromGlobals();
    if (str_starts_with($request->path, '/api/board-') || str_starts_with($request->path, '/b/') || str_starts_with($request->path, '/board-decision/')) {
        if (!is_array($boardConfig)) {
            throw new RuntimeException('Invalid Board configuration');
        }
        $boardGateway = new BoardGateway(
            PdoBoardCaseStore::connect((array) ($boardConfig['database'] ?? [])),
            new BoardCallbackClient((string) ($boardConfig['steward_origin'] ?? ''), (string) ($boardConfig['moderation_callback_secret'] ?? '')),
            (string) ($boardConfig['gateway_shared_secret'] ?? ''),
            (string) ($boardConfig['notification_api_secret'] ?? ''),
            (string) ($boardConfig['notification_encryption_secret'] ?? ''),
            (string) ($boardConfig['csrf_secret'] ?? ''),
            (string) ($config['public_origin'] ?? ''),
        );
        $boardGateway->handle($request)->send($request->method === 'HEAD');
    }
    $gateway->handle($request)->send($request->method === 'HEAD');
} catch (Throwable) {
    (new Hrm\Gateway\Response(503, Hrm\Gateway\page('Niedostępne', '<h1 style="font-size:22px">Usługa jest niedostępna.</h1>'), Hrm\Gateway\securityHeaders()))->send();
}
