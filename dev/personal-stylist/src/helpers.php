<?php
declare(strict_types=1);

/** HTML-escape for output. */
function e(?string $s): string
{
    return htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
}

/** Redirect within the app and stop. */
function redirect(string $path): void
{
    header('Location: ' . PS_BASE . $path);
    exit;
}

/** Emit a JSON response and stop. */
function json_out(mixed $data, int $code = 200): void
{
    http_response_code($code);
    header('Content-Type: application/json');
    echo json_encode($data, JSON_UNESCAPED_SLASHES);
    exit;
}
