<?php
declare(strict_types=1);

/**
 * Create (or reset the password of) the owner account.
 * Run over SSH from the app root:  php bin/init-user.php you@email.com
 * You'll be prompted for a password (not echoed to shell history).
 */

if (PHP_SAPI !== 'cli') {
    exit("CLI only.\n");
}

$configFile = __DIR__ . '/../config.php';
if (!is_file($configFile)) {
    exit("Missing config.php — copy config.sample.php to config.php first.\n");
}
define('PS_CONFIG', require $configFile);
require __DIR__ . '/../src/Db.php';

$email = $argv[1] ?? null;
if (!$email || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    exit("Usage: php bin/init-user.php you@email.com\n");
}

fwrite(STDOUT, 'Password: ');
$password = trim((string) fgets(STDIN));
if (strlen($password) < 8) {
    exit("Password must be at least 8 characters.\n");
}

$hash = password_hash($password, PASSWORD_DEFAULT);
$st = Db::conn()->prepare(
    'INSERT INTO users (email, password_hash) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)'
);
$st->execute([strtolower(trim($email)), $hash]);

fwrite(STDOUT, "Owner account ready: {$email}\n");
