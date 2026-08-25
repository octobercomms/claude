<?php
declare(strict_types=1);

/** Single-user auth (bcrypt + PHP session). */
final class Auth
{
    public static function attempt(string $email, string $password): bool
    {
        $st = Db::conn()->prepare(
            'SELECT id, password_hash FROM users WHERE email = ? LIMIT 1'
        );
        $st->execute([strtolower(trim($email))]);
        $u = $st->fetch();

        if ($u && password_verify($password, $u['password_hash'])) {
            session_regenerate_id(true);
            $_SESSION['uid'] = (int) $u['id'];
            return true;
        }
        return false;
    }

    public static function check(): bool
    {
        return !empty($_SESSION['uid']);
    }

    public static function id(): ?int
    {
        return $_SESSION['uid'] ?? null;
    }

    public static function logout(): void
    {
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $p = session_get_cookie_params();
            setcookie(session_name(), '', time() - 42000, $p['path'], $p['domain'], $p['secure'], $p['httponly']);
        }
        session_destroy();
    }
}
