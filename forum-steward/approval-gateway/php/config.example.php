<?php
declare(strict_types=1);

// Copy to config.php outside the public directory. Never commit config.php.
return [
    'public_origin' => 'https://approve.hrm.se',
    'repository' => 'HRM-Manifesto/HRM-Manifesto',

    'database' => [
        'host' => 'mysql000.loopia.se',
        'port' => 3306,
        'name' => 'example_database',
        'user' => 'example_user',
        'password' => 'REPLACE_WITH_RANDOM_DATABASE_PASSWORD',
    ],

    // Must exactly match the GitHub repository secrets used by Forum Steward.
    'approval_secret' => 'REPLACE_WITH_EXISTING_HRM_APPROVAL_SECRET',
    'gateway_shared_secret' => 'REPLACE_WITH_EXISTING_HRM_GATEWAY_SHARED_SECRET',

    // Independent random value, at least 32 characters.
    'csrf_secret' => 'REPLACE_WITH_NEW_RANDOM_CSRF_SECRET',

    // GitHub App installed only on HRM-Manifesto/HRM-Manifesto.
    'github_app_id' => 0,
    'github_installation_id' => 0,
    'github_private_key_path' => __DIR__ . '/private/hrm-gateway-app.pem',

    // Used only after Aleksander submits APPROVE or EDIT and only when translation is needed.
    'openai_api_key' => 'REPLACE_WITH_OPENAI_API_KEY',
    'openai_model' => 'gpt-5.4-nano',
];
