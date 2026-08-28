<?php
/**
 * AS IF — configuration sample.
 *
 * Copy this file to `config.php` (which is git-ignored) and fill in real values.
 * NEVER commit config.php or put real secrets in the repo.
 */
return [
    'app' => [
        'name'     => 'AS IF',
        // Public base URL, no trailing slash, e.g. https://asif.example.com
        'base_url' => 'https://your-domain',
        // 'local' shows errors; 'production' hides them.
        'env'      => 'production',
        // Long random string (e.g. `openssl rand -hex 32`).
        'secret'   => 'CHANGE_ME_to_a_long_random_string',
    ],

    'db' => [
        'host'    => 'localhost',
        'name'    => 'your_db_name',
        'user'    => 'your_db_user',
        'pass'    => 'your_db_password',
        'charset' => 'utf8mb4',
    ],

    // Absolute path OUTSIDE the web root for private uploads (garment / body
    // photos). Default assumes config.php sits one level above the web root.
    'storage_path' => __DIR__ . '/ps-storage',

    // API keys — Phase 2+ only. Leave blank for Phase 1 (manual tagging).
    'anthropic_api_key' => '',
    'fal_api_key'       => '',
];
