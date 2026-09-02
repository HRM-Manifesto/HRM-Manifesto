<?php
return [
    'database' => [
        'host' => 'mysql.example.invalid',
        'port' => 3306,
        'name' => 'dedicated_board_database',
        'user' => 'dedicated_board_user',
        'password' => 'secret',
    ],
    'steward_origin' => 'https://steward.hrm.se',
    'gateway_shared_secret' => 'same-dedicated-secret-as-the-public-steward',
    'moderation_callback_secret' => 'same-dedicated-callback-secret-as-the-public-steward',
    'notification_api_secret' => 'dedicated-secret-used-only-by-the-GitHub-notification-workflow',
    'notification_encryption_secret' => 'dedicated-secret-used-to-encrypt-one-time-links-at-rest',
    'csrf_secret' => 'dedicated-random-secret-at-least-32-bytes',
    // Store only password_hash(...), never the panel password itself.
    'admin_password_hash' => '$2y$12$REPLACE_WITH_PASSWORD_HASH',
];
