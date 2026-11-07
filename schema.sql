CREATE DATABASE IF NOT EXISTS levfin
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE levfin;

CREATE TABLE IF NOT EXISTS reports (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reference_time TIME NULL,
  companies JSON NOT NULL,
  saved_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_reports_saved_at (saved_at)
);

CREATE TABLE IF NOT EXISTS settings (
  setting_key VARCHAR(100) NOT NULL,
  setting_value JSON NOT NULL,
  PRIMARY KEY (setting_key)
);
