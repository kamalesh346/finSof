-- Finance Collection Management System Schema

CREATE DATABASE IF NOT EXISTS finance_app;
USE finance_app;

CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  username VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('ADMIN', 'AGENT') NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_role (role),
  INDEX idx_active (is_active)
);

CREATE TABLE customers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_code VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  address TEXT,
  phone VARCHAR(20),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_code (customer_code)
);

CREATE TABLE accounts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NOT NULL,
  loan_amount_enc TEXT NOT NULL,
  paid_amount_enc TEXT NOT NULL,
  interest_rate DECIMAL(5,2) DEFAULT 0.00,
  status ENUM('ACTIVE', 'CLOSED') DEFAULT 'ACTIVE',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  INDEX idx_customer (customer_id),
  INDEX idx_status (status)
);

CREATE TABLE daily_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_date DATE NOT NULL UNIQUE,
  status ENUM('OPEN', 'CLOSED') DEFAULT 'OPEN',
  opened_by INT NOT NULL,
  closed_by INT,
  opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  closed_at TIMESTAMP NULL,
  FOREIGN KEY (opened_by) REFERENCES users(id),
  FOREIGN KEY (closed_by) REFERENCES users(id),
  INDEX idx_date (session_date),
  INDEX idx_status (status)
);

CREATE TABLE transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  offline_id VARCHAR(36) NOT NULL UNIQUE,
  customer_id INT NOT NULL,
  customer_name VARCHAR(100) NOT NULL,
  account_id INT NOT NULL,
  agent_id INT NOT NULL,
  agent_name VARCHAR(100) NOT NULL,
  amount_enc TEXT NOT NULL,
  payment_mode ENUM('CASH', 'GPAY') NOT NULL,
  session_date DATE NOT NULL,
  collected_at TIMESTAMP NOT NULL,
  synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  duplicate_flag BOOLEAN DEFAULT FALSE,
  is_locked BOOLEAN DEFAULT FALSE,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (account_id) REFERENCES accounts(id),
  FOREIGN KEY (agent_id) REFERENCES users(id),
  INDEX idx_session_date (session_date),
  INDEX idx_customer_account (customer_id, account_id),
  INDEX idx_agent (agent_id),
  INDEX idx_duplicate (duplicate_flag)
);

CREATE TABLE duplicate_flags (
  id INT AUTO_INCREMENT PRIMARY KEY,
  transaction_id INT NOT NULL,
  original_transaction_id INT NOT NULL,
  resolved BOOLEAN DEFAULT FALSE,
  resolution ENUM('ACCEPTED', 'EDITED', 'REJECTED') NULL,
  resolved_by INT NULL,
  resolved_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (transaction_id) REFERENCES transactions(id),
  FOREIGN KEY (original_transaction_id) REFERENCES transactions(id),
  FOREIGN KEY (resolved_by) REFERENCES users(id)
);

CREATE TABLE sync_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  agent_id INT NOT NULL,
  offline_id VARCHAR(36) NOT NULL,
  status ENUM('SUCCESS', 'FAILED', 'DUPLICATE') NOT NULL,
  error_message TEXT,
  synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (agent_id) REFERENCES users(id),
  INDEX idx_agent (agent_id),
  INDEX idx_status (status)
);

-- Default admin user (password: admin123)
INSERT INTO users (name, username, password_hash, role) VALUES
('Admin', 'admin', '$2b$10$rQnJ8Y5Z6VXpM2K3L4N5OuBhI9yR7sT1wE6dF3gH0jK8mP4qA1cN2', 'ADMIN');
