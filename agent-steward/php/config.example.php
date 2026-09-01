<?php
return [
    'database' => ['host' => 'mysql.example', 'port' => 3306, 'name' => 'database', 'user' => 'steward_user', 'password' => 'secret'],
    'approval_gateway_origin' => 'https://approve.hrm.se',
    'approval_gateway_shared_secret' => 'generate-a-dedicated-random-secret-at-least-32-bytes',
    'moderation_callback_secret' => 'generate-another-random-secret-at-least-32-bytes',
    'rate_limit_secret' => 'generate-another-random-secret-at-least-32-bytes',
];
