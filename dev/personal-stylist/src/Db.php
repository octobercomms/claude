<?php
declare(strict_types=1);

/** Single shared PDO connection. */
final class Db
{
    private static ?PDO $pdo = null;

    public static function conn(): PDO
    {
        if (self::$pdo === null) {
            $c = PS_CONFIG['db'];
            $dsn = "mysql:host={$c['host']};dbname={$c['name']};charset={$c['charset']}";
            self::$pdo = new PDO($dsn, $c['user'], $c['pass'], [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES   => false,
            ]);
        }
        return self::$pdo;
    }
}
