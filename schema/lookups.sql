-- Index for fast current price lookups
CREATE INDEX idx_price_history_stock_timestamp 
ON price_history (stock_id, timestamp DESC);

-- Current price query uses index exclusively
SELECT price FROM price_history 
WHERE stock_id = ? 
ORDER BY timestamp DESC 
LIMIT 1;  -- Stops after 1 row, index-only scan possible

-- Chart data also uses same index
SELECT price, timestamp FROM price_history 
WHERE stock_id = ? 
AND timestamp > NOW() - INTERVAL '1 day'
ORDER BY timestamp DESC;