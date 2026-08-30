CREATE TABLE hrm_approval_cases (
  notification_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  approval_record MEDIUMTEXT NOT NULL,
  status ENUM('active','processing','published','rejected','duplicate','invalid','failed') NOT NULL DEFAULT 'active',
  expires_at DATETIME(6) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  decided_at DATETIME(6) NULL,
  result_url TEXT NULL,
  PRIMARY KEY (notification_key),
  UNIQUE KEY uq_hrm_approval_token_hash (token_hash)
) ENGINE=InnoDB;
