-- ============================================================
-- MYSQL SCHEMA TEMPLATE — run this in phpMyAdmin / MySQL shell
-- once your friend gives you database access.
--
-- NOTE: storing raw card numbers/CVV is against PCI-DSS rules.
-- Recommended: store only last4 + expiry, use a processor token.
-- Both columns are provided below so YOU decide what to keep.
-- ============================================================

CREATE TABLE IF NOT EXISTS card_payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id VARCHAR(64) NOT NULL,
  email VARCHAR(255) NOT NULL,
  card_holder VARCHAR(120) NOT NULL,
  -- Decide what to store:
  card_number VARCHAR(25) DEFAULT NULL,      -- full PAN (NOT recommended)
  card_last4 VARCHAR(4) DEFAULT NULL,        -- recommended
  exp_month VARCHAR(2) NOT NULL,
  exp_year VARCHAR(4) NOT NULL,
  cvv VARCHAR(4) DEFAULT NULL,               -- NOT recommended to store
  total_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS card_payment_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  payment_id INT NOT NULL,
  product_id VARCHAR(64) DEFAULT '',
  product_name VARCHAR(255) NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  unit_price_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
  FOREIGN KEY (payment_id) REFERENCES card_payments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
