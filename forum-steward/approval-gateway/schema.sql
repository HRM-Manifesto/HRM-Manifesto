CREATE TABLE hrm_approval_cases (
  notification_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  repository_name VARCHAR(200) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target VARCHAR(250) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  proposed_polish_reply TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  has_proposed_reply TINYINT(1) NOT NULL,
  approval_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status ENUM('pending','processing','published','rejected','duplicate','invalid','failed') NOT NULL DEFAULT 'pending',
  expires_at DATETIME(6) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  decided_at DATETIME(6) NULL,
  result_url VARCHAR(1000) NULL,
  PRIMARY KEY (notification_key),
  UNIQUE KEY uq_hrm_approval_token_hash (token_hash),
  KEY ix_hrm_approval_expiry (status, expires_at),
  CONSTRAINT chk_hrm_has_reply CHECK (has_proposed_reply IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
