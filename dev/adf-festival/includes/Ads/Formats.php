<?php
declare(strict_types=1);

namespace ADF\Ads;

defined('ABSPATH') || exit;

/**
 * Ad formats / sizes — the single source of truth (mirrors OCAD_FORMATS).
 */
final class Formats {

    public const ALL = [
        'mpu'         => ['label' => 'MPU',         'w' => 300, 'h' => 250],
        'leaderboard' => ['label' => 'Leaderboard', 'w' => 728, 'h' => 90],
        'skyscraper'  => ['label' => 'Skyscraper',  'w' => 160, 'h' => 600],
    ];

    public static function exists(string $format): bool {
        return isset(self::ALL[$format]);
    }

    public static function keys(): array {
        return array_keys(self::ALL);
    }

    public static function dimensions(string $format): array {
        return self::ALL[$format] ?? ['label' => $format, 'w' => 0, 'h' => 0];
    }
}
