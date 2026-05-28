CREATE DATABASE IF NOT EXISTS marketsim;
USE marketsim;

CREATE TABLE IF NOT EXISTS users (
    user_id CHAR(36) NOT NULL DEFAULT (UUID()),
    username VARCHAR(30) UNIQUE NOT NULL,
    p_hash VARCHAR(60) NOT NULL,
    registration_date TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    cash DECIMAL(10,2) DEFAULT 0.00,
    reserved_cash DECIMAL(10,2) DEFAULT 0.00,
    deposited_cash DECIMAL(10,2) DEFAULT 0.00,
    PRIMARY KEY (user_id)
);

CREATE TABLE IF NOT EXISTS stocks (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    ticker VARCHAR(10) UNIQUE NOT NULL,
    name VARCHAR(100),
    sector VARCHAR(50),
    description TEXT,
    price DECIMAL(10,2),
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS portfolio (
    user_id CHAR(36) NOT NULL,
    ticker VARCHAR(10) NOT NULL,
    shares DECIMAL(12, 4) NOT NULL DEFAULT 0,
    reserved_shares DECIMAL(12, 4) NOT NULL DEFAULT 0,
    total_cost DECIMAL(12, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, ticker),
    CONSTRAINT fk_portfolio_user
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    CONSTRAINT fk_portfolio_ticker
        FOREIGN KEY (ticker) REFERENCES stocks(ticker) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS price_history (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    stock_id BIGINT UNSIGNED NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    filled DECIMAL(12,4) NOT NULL DEFAULT 0,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    trade_id INT,
    PRIMARY KEY (id),
    CONSTRAINT fk_price_history_stock
        FOREIGN KEY (stock_id) REFERENCES stocks(id) ON DELETE CASCADE,
    INDEX idx_price_history_stock_timestamp (stock_id, timestamp DESC)
);

CREATE TABLE IF NOT EXISTS orders (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id CHAR(36) NOT NULL,
    ticker VARCHAR(10) NOT NULL,
    side ENUM('BUY', 'SELL') NOT NULL,
    type ENUM('MARKET', 'LIMIT') NOT NULL,
    price DECIMAL(12, 2),
    quantity DECIMAL(12, 4) NOT NULL,
    filled_quantity DECIMAL(12, 4) DEFAULT 0,
    filled_cost DECIMAL(10, 2) DEFAULT 0,
    estimated_amount DECIMAL(12, 2) DEFAULT 0,
    status ENUM('OPEN', 'FILLED', 'PARTIALLY_FILLED', 'CANCELED', 'REJECTED') DEFAULT 'OPEN',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_orders_user
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    CONSTRAINT fk_orders_ticker
        FOREIGN KEY (ticker) REFERENCES stocks(ticker) ON DELETE CASCADE,
    INDEX idx_user_id (user_id),
    INDEX idx_ticker (ticker),
    INDEX idx_status (status)
);
