<?php
declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';

$path   = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$path   = rtrim($path, '/') ?: '/';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// Health check (no auth) — confirms PHP + DB are wired up.
if ($path === '/health') {
    try {
        Db::conn()->query('SELECT 1');
        json_out(['ok' => true, 'db' => true]);
    } catch (Throwable $ex) {
        json_out(['ok' => false, 'db' => false], 500);
    }
}

if ($path === '/logout') {
    Auth::logout();
    redirect('/login');
}

if ($path === '/login') {
    $error = null;
    if ($method === 'POST') {
        if (!Csrf::check($_POST['csrf'] ?? null)) {
            $error = 'Session expired — please try again.';
        } elseif (Auth::attempt((string) ($_POST['email'] ?? ''), (string) ($_POST['password'] ?? ''))) {
            redirect('/');
        } else {
            $error = 'That email and password don\'t match.';
        }
    }
    require __DIR__ . '/views/login.php';
    exit;
}

// Everything below requires a logged-in owner.
if (!Auth::check()) {
    redirect('/login');
}

require __DIR__ . '/views/app.php';
