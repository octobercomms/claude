-- AS IF — database schema (Phase 1 core).
-- MySQL / MariaDB, utf8mb4. Import once into your database, then run db/seed.sql.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS users (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  email          VARCHAR(190) NOT NULL,
  password_hash  VARCHAR(255) NOT NULL,
  remember_token VARCHAR(64)  DEFAULT NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS settings (
  `key`   VARCHAR(64) NOT NULL,
  `value` TEXT,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS locations (
  id   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(80) NOT NULL,
  lat  DECIMAL(9,6) DEFAULT NULL,
  lon  DECIMAL(9,6) DEFAULT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS items (
  id                     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name                   VARCHAR(120) NOT NULL,
  type                   VARCHAR(40)  DEFAULT NULL,
  subtype                VARCHAR(40)  DEFAULT NULL,
  colours                JSON         DEFAULT NULL,
  pattern                VARCHAR(40)  DEFAULT NULL,
  fabric                 VARCHAR(40)  DEFAULT NULL,
  warmth                 TINYINT      DEFAULT NULL,   -- 1..5
  formality              TINYINT      DEFAULT NULL,   -- 1..5
  seasons                JSON         DEFAULT NULL,
  care                   JSON         DEFAULT NULL,
  location_id            INT UNSIGNED DEFAULT NULL,
  wash_state             ENUM('clean','worn_ok','basket','washing') NOT NULL DEFAULT 'clean',
  committed_to_outfit_id INT UNSIGNED DEFAULT NULL,
  wear_count             INT UNSIGNED NOT NULL DEFAULT 0,
  last_worn_at           DATE         DEFAULT NULL,
  last_worn_location_id  INT UNSIGNED DEFAULT NULL,
  status                 ENUM('active','stored','archived') NOT NULL DEFAULT 'active',
  notes                  TEXT,
  created_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_items_location (location_id),
  KEY idx_items_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS item_photos (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  item_id    INT UNSIGNED NOT NULL,
  path       VARCHAR(255) NOT NULL,
  is_primary TINYINT(1)   NOT NULL DEFAULT 0,
  width      INT UNSIGNED DEFAULT NULL,
  height     INT UNSIGNED DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_photos_item (item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS outfits (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name            VARCHAR(120) DEFAULT NULL,
  planned_date    DATE         DEFAULT NULL,
  occasion        VARCHAR(120) DEFAULT NULL,
  location_id     INT UNSIGNED DEFAULT NULL,
  weather_context JSON         DEFAULT NULL,
  rationale       TEXT,
  rating          TINYINT      DEFAULT NULL,
  effort_level    TINYINT      DEFAULT NULL,          -- 1..5
  source          ENUM('ai','manual') NOT NULL DEFAULT 'manual',
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS outfit_items (
  outfit_id INT UNSIGNED NOT NULL,
  item_id   INT UNSIGNED NOT NULL,
  role      VARCHAR(20) DEFAULT NULL,   -- top | bottom | outer | shoes | accessory
  PRIMARY KEY (outfit_id, item_id),
  KEY idx_oi_item (item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS wear_log (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  item_id     INT UNSIGNED NOT NULL,
  worn_on     DATE NOT NULL,
  location_id INT UNSIGNED DEFAULT NULL,
  weather     JSON         DEFAULT NULL,
  outfit_id   INT UNSIGNED DEFAULT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_wear_item (item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
