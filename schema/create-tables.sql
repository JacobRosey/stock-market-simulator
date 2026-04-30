USE marketsim;

CREATE TABLE users (
    id char(36) NOT NULL DEFAULT (uuid()),
    username varchar(30) UNIQUE NOT NULL,
    p_hash varchar(60) NOT NULL,
    registration_date timestamp NULL DEFAULT CURRENT_TIMESTAMP,
    cash DECIMAL(10,2) DEFAULT 0.00,
    reserved_cash DECIMAL(10,2) DEFAULT 0.00,
    deposited_cash DECIMAL(10,2) DEFAULT 0.00,
    PRIMARY KEY (id)
);

CREATE TABLE stocks (
    id SERIAL PRIMARY KEY,
    ticker VARCHAR(10) UNIQUE NOT NULL,
    name VARCHAR(100),
    sector VARCHAR(50),
    description TEXT,
    price DECIMAL(10,2)
);

CREATE TABLE portfolio (
    user_id CHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ticker VARCHAR(10) NOT NULL,
    shares DECIMAL(12, 4) NOT NULL DEFAULT 0,
    reserved_shares DECIMAL(12, 4) NOT NULL DEFAULT 0,
    cost_basis DECIMAL(12, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, ticker)
);

CREATE TABLE price_history (
    id SERIAL PRIMARY KEY,
    stock_id INTEGER REFERENCES stocks(id),
    price DECIMAL(10,2) NOT NULL,
    filled DECIMAL(12,4) NOT NULL DEFAULT 0,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    trade_id INTEGER -- optional, link to specific trade
);

CREATE TABLE orders (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id CHAR(36) NOT NULL,
    ticker VARCHAR(10) NOT NULL,
    side ENUM('BUY', 'SELL') NOT NULL,
    type ENUM('MARKET', 'LIMIT') NOT NULL,
    price DECIMAL(12, 2),
    quantity DECIMAL(12, 4) NOT NULL,
    filled_quantity DECIMAL(12, 4) DEFAULT 0,
    filled_cost DECIMAL(10, 2) DEFAULT 0,
    status ENUM('OPEN', 'FILLED', 'PARTIALLY_FILLED', 'CANCELED', 'REJECTED') DEFAULT 'OPEN',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_id (user_id),
    INDEX idx_ticker (ticker),
    INDEX idx_status (status)
);