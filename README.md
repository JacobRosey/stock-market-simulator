# Stock Market Simulator

A real‑time multiplayer stock market simulation where users compete against each other and bots to climb the leaderboard, which ranks users by total account value.

---

## Key Features

- **Real‑time order matching** with price‑time priority
- **Cancelable limit orders** with O(1) lookup
- **Multi‑user** with per‑ticker WebSocket subscriptions
- **Trading bots** that provide liquidity and volume (planned)
- **Live charts** with multiple timeframes
- **Portfolio tracking** with average cost basis

---

## Tech Stack

| Component | Technologies |
| :--- | :--- |
| **Matching Engine** | C++17, Redis++, nlohmann/json |
| **Backend** | Node.js, Express, Socket.IO, MySQL |
| **Frontend** | React, TypeScript, Recharts |
| **Infrastructure** | Redis (IPC), WebSockets, MySQL |
 

---

## Architecture

### Matching Engine (C++)
The core of the system is a multi-threaded matching engine that processes limit orders, market orders, and order cancellation.

- **Order types**: Market and limit orders - ordered sets for limit orders, FIFO queue for market orders
- **Data structures**: std::set for limit orders (sorted by price‑time priority); std::unordered_map mapping order ID → set iterator for O(1) cancellation. Custom classes for Order, OrderBook, MatchingEngine, etc.
- **Thread safety**: Per‑ticker mutexes to minimize lock contention 
- **Performance**: Matching thread decoupled from Redis pub/sub threads to prevent matching from being I/O bound; batched fill publishing using a shared queue between matching engine and publisher threads     
    - **Peak matching throughput**: 450,000 fills/sec on cold start with all books filled with easily matched orders (minimal book walking required) and no new orders being placed
    - **Sustained matching throughput**: ~200,000 fills/sec under realistic market conditions 
    - **Batch fill publishing**: Occurs every 150 fills or 100ms, whichever comes first. Balances responsiveness, shared queue memory usage, and minimizing lock contention
    
    >Benchmarks performed on an Intel i7-8700K (6C/12T @ 3.7GHz) with 16GB RAM.
      
### Backend (Node.js + Express)
Handles user authentication, order placement, and portfolio management.  Serves initial data (price history, portfolio state) from the database; all subsequent updates are pushed via WebSocket.

- **Authentication**: JWT‑based — tokens are validated on protected routes; missing or invalid tokens block access
- **Order flow**: Validates user balance, reserves funds, and publishes to Redis
- **Database**: MySQL stores users, orders, portfolios, price history, etc.
- **IPC**: Redis pub/sub enables bidirectional communication between Node and the C++ matching engine
- **Real‑time updates**: WebSocket connections are mapped to user IDs and ticker rooms. Updates are pushed to the correct clients via per‑user and per‑ticker channels

### Frontend (React + TypeScript)
Real‑time dashboard for trading and market data.

- **Real‑time updates**: WebSocket subscriptions per ticker for stock price and orderbook depth data
- **Charts**: Recharts with adjustable time ranges and live updates
- **Order book**: Displays top 3 bid/ask levels with live updates
- **Trading form**: Market and limit order entry with validation (cash / share availability)
- **Portfolio**: Tracks available cash, positions, and P&L (account-wide and per ticker)

### Database (MySQL)
- **Users**: UUID, Username, hashed password, available cash, reserved cash (for pending orders; prevent double-spending) 
- **Portfolio**: Ticker, shares owned, total cost, reserved shares
- **Orders**: Status (OPEN, FILLED, PARTIALLY_FILLED, CANCELLED), quantity, filled quantity, cost, ask user id, bid user id, type (market/limit), side(bid/ask)
- **Price history**: Every trade stored for charting (pruned periodically)




