<?php
declare(strict_types=1);

/**
 * Shared bootstrap: config, error handling, secure session, core classes.
 * Included by public/index.php on every web request.
 */

$configFile = __DIR__ . '/../config.php';
if (!is_file($configFile)) {
    http_response_code(500);
    exit('Missing config.php — copy config.sample.php to config.php and fill it in.');
}

/** @var array $config */
$config = require $configFile;
define('PS_CONFIG', $config);
define('PS_BASE', rtrim($config['app']['base_url'] ?? '', '/'));

$isLocal = ($config['app']['env'] ?? 'production') === 'local';
error_reporting(E_ALL);
ini_set('display_errors', $isLocal ? '1' : '0');

// Secure session cookie.
$secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
session_set_cookie_params([
    'lifetime' => 0,
    'path'     => '/',
    'httponly' => true,
    'secure'   => $secure,
    'samesite' => 'Lax',
]);
session_name('asif_sess');
session_start();

require __DIR__ . '/Db.php';
require __DIR__ . '/Csrf.php';
require __DIR__ . '/Auth.php';
require __DIR__ . '/helpers.php';
