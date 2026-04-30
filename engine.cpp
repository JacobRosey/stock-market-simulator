#include <iostream>
#include <thread>
#include <chrono>
#include <mutex>
#include <queue>
#include <atomic>
#include <array>
#include <condition_variable>
#include <optional>
#include <unordered_map>
#include <vector>
#include <sw/redis++/redis++.h>
#include <map>
#include <set>
#include <nlohmann/json.hpp>

using json = nlohmann::json;

using namespace sw::redis;

struct PriceLevel
{
    uint64_t price;
    uint64_t totalQuantity;
};

struct DepthSnapshot
{
    std::vector<PriceLevel> topBids;
    std::vector<PriceLevel> topAsks;
};

enum class Side
{
    BUY,
    SELL
};
enum class OrderType
{
    MARKET,
    LIMIT
};

static constexpr uint64_t MICRO_UNIT = 1000000;

uint64_t getTimestamp()
{
    return std::chrono::system_clock::now().time_since_epoch().count();
}

class Order
{
public:
    uint64_t orderId;
    std::string userId;
    std::string ticker;
    Side side;
    OrderType orderType;
    std::optional<uint64_t> price;
    uint64_t estimatedCost;
    uint64_t quantity;
    uint64_t remainingQuantity;
    uint64_t timestamp;

    // Constructor from JSON
    explicit Order(const json &j)
    {
        orderId = j["id"].get<uint64_t>();
        userId = j["userId"].get<std::string>();
        ticker = j["ticker"].get<std::string>();
        side = j["side"].get<std::string>() == "BUY" ? Side::BUY : Side::SELL;
        orderType = j["type"].get<std::string>() == "MARKET" ? OrderType::MARKET : OrderType::LIMIT;
        estimatedCost = j["estimatedCost"].get<uint64_t>();

        if (orderType == OrderType::LIMIT)
        {
            price = j["price"].get<uint64_t>();
        }
        else
        {
            price = std::nullopt;
        }

        quantity = j["quantity"].get<uint64_t>();
        remainingQuantity = quantity;
        timestamp = j["timestamp"].get<uint64_t>();
    }

    // For bids: higher price first, then earlier timestamp
    struct CompareBids
    {
        bool operator()(const Order &a, const Order &b) const
        {
            if (a.price != b.price)
                return a.price > b.price;
            if (a.timestamp != b.timestamp)
                return a.timestamp < b.timestamp;
            return a.orderId < b.orderId; // final tiebreaker, guaranteed unique
        }
    };

    // For asks: lower price first, then earlier timestamp
    struct CompareAsks
    {
        bool operator()(const Order &a, const Order &b) const
        {
            if (a.price != b.price)
                return a.price < b.price;
            if (a.timestamp != b.timestamp)
                return a.timestamp < b.timestamp;
            return a.orderId < b.orderId;
        }
    };

    // For market orders just use FIFO
    struct CompareMarketOrders
    {
        bool operator()(const Order &a, const Order &b) const
        {
            return a.timestamp < b.timestamp;
        }
    };
};

class FilledOrder
{
public:
    std::string bidUserId;
    std::string askUserId;
    uint64_t bidOrderId;
    uint64_t askOrderId;
    uint64_t bidRemainingQuantity;
    uint64_t askRemainingQuantity;
    std::string ticker;
    uint64_t filledPrice;
    uint64_t filledQuantity;
    uint64_t timestamp;

    explicit FilledOrder(std::string bidUserId, std::string askUserId, uint64_t bidOrderId, uint64_t askOrderId, uint64_t brq, uint64_t arq, std::string t, uint64_t fq, uint64_t fp)
        : bidUserId(bidUserId), askUserId(askUserId), bidOrderId(bidOrderId), askOrderId(askOrderId), bidRemainingQuantity(brq), askRemainingQuantity(arq), ticker(t), filledQuantity(fq), filledPrice(fp), timestamp(getTimestamp()) {}

    json toJson() const
    {
        return {
            {"bidUserId", bidUserId},
            {"askUserId", askUserId},
            {"bidOrderId", bidOrderId},
            {"askOrderId", askOrderId},
            {"bidRemainingQuantity", bidRemainingQuantity},
            {"askRemainingQuantity", askRemainingQuantity},
            {"ticker", ticker},
            {"filledPrice", filledPrice},
            {"filledQuantity", filledQuantity},
            {"timestamp", timestamp}};
    }
};

class RejectedOrder
{
public:
    uint64_t orderId;
    std::string userId;
    std::string ticker;
    std::string side;
    uint64_t rejectedQuantity;
    std::string reason;
    uint64_t timestamp;

    explicit RejectedOrder(uint64_t orderId, std::string userId, std::string ticker, Side side, uint64_t rejectedQuantity, std::string reason)
        : orderId(orderId),
          userId(userId),
          ticker(ticker),
          side(side == Side::BUY ? "BUY" : "SELL"),
          rejectedQuantity(rejectedQuantity),
          reason(reason),
          timestamp(getTimestamp()) {}

    json toJson() const
    {
        return {
            {"orderId", orderId},
            {"userId", userId},
            {"ticker", ticker},
            {"side", side},
            {"rejectedQuantity", rejectedQuantity},
            {"reason", reason},
            {"timestamp", timestamp}};
    }
};

class OrderBook
{
private:
    std::set<Order, Order::CompareBids> limitBids;
    std::set<Order, Order::CompareAsks> limitAsks;

    std::set<Order, Order::CompareMarketOrders> marketBids;
    std::set<Order, Order::CompareMarketOrders> marketAsks;

    // Map order ids to order iterator to allow for O(1) cancellation
    using BidIterator = std::set<Order, Order::CompareBids>::iterator;
    using AskIterator = std::set<Order, Order::CompareAsks>::iterator;
    std::unordered_map<uint64_t, BidIterator> bidIdToIterator;
    std::unordered_map<uint64_t, AskIterator> askIdToIterator;

    // Price tracking for orderbook depth
    std::map<uint64_t, uint64_t, std::greater<uint64_t>> bidLevels;
    std::map<uint64_t, uint64_t> askLevels;

    static constexpr size_t DEPTH = 3; // adjust if more level visibility needed

    template <typename MapType>
    void updateLevel(MapType &levels, uint64_t price, int64_t delta) // Delta was unsigned initially which caused wraparound when removing depth from level 
    {
        auto it = levels.find(price);
        if (it != levels.end())
        {
            it->second += delta;
            if (it->second <= 0)
            {
                levels.erase(it);
            }
        }
        // If no depth exists and delta is positive - set depth
        else if (delta > 0)
        {
            levels[price] = delta;
        }
    }

public:
    void clearMarketOrders()
    {
        marketBids = std::set<Order, Order::CompareMarketOrders>();
        marketAsks = std::set<Order, Order::CompareMarketOrders>();
    }

    void addBid(const Order &order)
    {
        if (order.orderType == OrderType::LIMIT)
        {
            auto [it, inserted] = limitBids.insert(order);
            if (inserted)
            {
                bidIdToIterator[order.orderId] = it; // Store iterator in map for cancellations
                updateLevel(bidLevels, order.price.value(), order.remainingQuantity);
            }
        }
        else
        {
            marketBids.insert(order);
        }
    }

    void addAsk(const Order &order)
    {
        if (order.orderType == OrderType::LIMIT)
        {
            auto [it, inserted] = limitAsks.insert(order);
            if (inserted)
            {
                askIdToIterator[order.orderId] = it; // Store iterator in map for cancellations
                updateLevel(askLevels, order.price.value(), order.remainingQuantity);
            }
        }
        else
        {
            marketAsks.insert(order);
        }
    }

    void eraseLimitBid(std::set<Order, Order::CompareBids>::iterator it)
    {
        uint64_t orderId = it->orderId;
        updateLevel(bidLevels, it->price.value(), -(int64_t)it->remainingQuantity);
        limitBids.erase(it);
        bidIdToIterator.erase(orderId);
    }

    void eraseLimitAsk(std::set<Order, Order::CompareAsks>::iterator it)
    {
        uint64_t orderId = it->orderId;
        updateLevel(askLevels, it->price.value(), -(int64_t)it->remainingQuantity);
        limitAsks.erase(it);
        askIdToIterator.erase(orderId);
    }

    const auto &getMarketBids() const { return marketBids; }
    const auto &getMarketAsks() const { return marketAsks; }

    const auto &getLimitBids() const { return limitBids; }
    const auto &getLimitAsks() const { return limitAsks; }

    bool canFillLimitOrders() const
    {
        if (limitBids.empty() || limitAsks.empty())
            return false;

        const auto bidIt = getLimitBids().begin();
        const auto askIt = getLimitAsks().begin();
        return bidIt->price.value() >= askIt->price.value();
    }

    bool hasOrders() const { return !limitBids.empty() && !limitAsks.empty(); }

    Order popMarketBid()
    {
        auto it = marketBids.begin();
        Order top = *it;
        marketBids.erase(it);
        return top;
    }

    Order popMarketAsk()
    {
        auto it = marketAsks.begin();
        Order top = *it;
        marketAsks.erase(it);
        return top;
    }

    DepthSnapshot getDepth() const
    {
        DepthSnapshot snap;

        auto it = bidLevels.begin();
        for (size_t i = 0; i < DEPTH && it != bidLevels.end(); ++i, ++it)
        {
            snap.topBids.push_back({it->first, it->second});
        }

        auto it2 = askLevels.begin();
        for (size_t i = 0; i < DEPTH && it2 != askLevels.end(); ++i, ++it2)
        {
            snap.topAsks.push_back({it2->first, it2->second});
        }

        return snap;
    }

    // Book is already locked by calling function
    bool attemptOrderCancellation(uint64_t orderId, std::string side)
    {

        if (side == "BUY")
        {
            auto it = bidIdToIterator.find(orderId);
            if (it != bidIdToIterator.end())
            {
                eraseLimitBid(it->second);
            }
            else
                return false;
        }
        else
        {
            auto it = askIdToIterator.find(orderId);
            if (it != askIdToIterator.end())
            {
                eraseLimitAsk(it->second);
            }
            else
                return false;
        }
        return true;
    }
};

class MatchingEngine
{
private:
    static constexpr std::array<const char *, 20> TICKERS = {
        "NEXUS", "QCI", "CLSE", "NSMC",
        "AGB", "CRC", "SGI", "FINT",
        "MEGA", "TREND", "GLG", "CLICK",
        "IDYN", "AUTO", "AERO", "GSYS",
        "GMED", "BIOV", "GENH", "NEURO"};

    std::array<OrderBook, 20> books;
    std::array<std::mutex, 20> bookMutexes;
    std::unordered_map<std::string, size_t> tickerToIndex;
    std::unordered_map<std::string, uint64_t> tickerPrices;
    std::queue<FilledOrder> fillQueue;
    std::queue<RejectedOrder> rejectedQueue;
    std::mutex fillMutex;
    std::condition_variable fillCV;
    std::mutex rejectedMutex;
    Redis redis;

public:
    MatchingEngine() : redis("tcp://127.0.0.1:6379")
    {
        for (size_t i = 0; i < std::size(TICKERS); i++)
        {
            tickerToIndex[TICKERS[i]] = i; // Populate ticker->index map

            tickerPrices[TICKERS[i]] = 0.0;
        }
    }

    std::tuple<OrderBook &, std::mutex &> getBookAndMutex(std::string t)
    {
        int idx = tickerToIndex[t];
        auto &book = books[idx];
        auto &mutex = bookMutexes[idx];

        return std::tuple<OrderBook &, std::mutex &>(book, mutex);
    }

    void enqueueFills(std::vector<FilledOrder> &fills)
    {
        if (fills.empty())
            return;
        {
            std::lock_guard<std::mutex> lock(fillMutex);
            for (auto &f : fills)
                fillQueue.push(std::move(f));
        }
        fillCV.notify_one();
    }

    void enqueueRejections(std::vector<RejectedOrder> &rejections)
    {
        if (rejections.empty())
            return;
        {
            std::lock_guard<std::mutex> lock(rejectedMutex);
            for (auto &r : rejections)
                rejectedQueue.push(std::move(r));
        }
    }

    // Blocks until the we have maxBatch fills in fill queue or timeout, returns batch of filled orders
    std::vector<FilledOrder> waitAndDrain(std::chrono::milliseconds timeout, size_t maxBatch)
    {
        std::unique_lock<std::mutex> lock(fillMutex);
        fillCV.wait_for(lock, timeout, [&]
                        { return fillQueue.size() >= maxBatch; });

        std::vector<FilledOrder> batch;
        while (!fillQueue.empty() && batch.size() < maxBatch)
        {
            batch.push_back(std::move(fillQueue.front()));
            fillQueue.pop();
        }
        return batch;
    }

    std::vector<RejectedOrder> drainRejected(size_t maxBatch)
    {
        std::lock_guard<std::mutex> lock(rejectedMutex);

        std::vector<RejectedOrder> batch;
        while (!rejectedQueue.empty() && batch.size() < maxBatch)
        {
            batch.push_back(std::move(rejectedQueue.front()));
            rejectedQueue.pop();
        }
        return batch;
    }

    void publishDepthForTicker(Redis &r, const std::string &ticker, const DepthSnapshot &snap, const std::unordered_map<std::string, uint64_t> &tickerPrices)
    {                  
        json j;
        auto it = tickerPrices.find(ticker);
        j["lastPrice"] = (it != tickerPrices.end()) ? it->second  : 0.0;
        j["asks"] = json::array();
        j["bids"] = json::array();

        for (auto it = snap.topAsks.rbegin(); it != snap.topAsks.rend(); ++it){
            j["asks"].push_back({{"price", it->price }, {"quantity", it->totalQuantity }});
        }

        for (auto &l : snap.topBids)
            j["bids"].push_back({{"price", l.price  }, {"quantity", l.totalQuantity  }});

        std::string channel = "orders:depth:" + ticker;
        std::string message = j.dump();

        r.publish(channel, message);
    }

    void addMarketOrder(const Order &order)
    {

        auto [book, mutex] = getBookAndMutex(order.ticker);

        {
            std::lock_guard<std::mutex> lock(mutex);
            if (order.side == Side::BUY)
            {
                book.addBid(order);
            }
            else
            {
                book.addAsk(order);
            }
        }
    }

    void addLimitOrder(const Order &order)
    {

        auto [book, mutex] = getBookAndMutex(order.ticker);

        {
            std::lock_guard<std::mutex> lock(mutex);
            
            if (order.side == Side::BUY)
            {
                book.addBid(order);
            }
            else
            {
                book.addAsk(order);
            }
        }
    }

    bool cancelOrder(const uint64_t orderId, const std::string ticker, const std::string side)
    {
        auto [book, mutex] = getBookAndMutex(ticker);

        bool success;
        {
            std::lock_guard<std::mutex> lock(mutex);
            success = book.attemptOrderCancellation(orderId, side);
        }
        return success;
    }

    void matchMarketOrdersForTicker(const std::string &ticker)
    {
        auto [book, mutex] = getBookAndMutex(ticker);

        std::vector<FilledOrder> filledOrders;
        std::vector<RejectedOrder> rejectedOrders;

        {
            std::lock_guard<std::mutex> lock(mutex);

            while (!book.getMarketAsks().empty())
            {
                Order marketAsk = book.popMarketAsk();

                while (marketAsk.remainingQuantity > 0)
                {
                    // Walk limit bids to find a non-self-trade counterparty
                    auto bidIt = book.getLimitBids().begin();
                    while (bidIt != book.getLimitBids().end() && bidIt->userId == marketAsk.userId)
                    {
                        ++bidIt;
                    }

                    // No valid counterparty for this order; reject remainder immediately.
                    if (bidIt == book.getLimitBids().end())
                    {
                        rejectedOrders.emplace_back(
                            marketAsk.orderId,
                            marketAsk.userId,
                            marketAsk.ticker,
                            marketAsk.side,
                            marketAsk.remainingQuantity,
                            "No fillable liquidity available for market sell");
                        break;
                    }

                    Order limitBid = *bidIt;
                    uint64_t filledQuantity = std::min(marketAsk.remainingQuantity, limitBid.remainingQuantity);

                    marketAsk.remainingQuantity -= filledQuantity;
                    limitBid.remainingQuantity -= filledQuantity;

                    book.eraseLimitBid(bidIt);

                    if (limitBid.remainingQuantity > 0)
                        book.addBid(limitBid);

                    filledOrders.emplace_back(
                        limitBid.userId, marketAsk.userId,
                        limitBid.orderId, marketAsk.orderId,
                        limitBid.remainingQuantity, marketAsk.remainingQuantity,
                        ticker, filledQuantity, limitBid.price.value());
                }
            }

            // Market bids vs limit asks
            while (!book.getMarketBids().empty())
            {
                Order marketBid = book.popMarketBid();
                uint64_t remainingBudget = marketBid.estimatedCost;
                std::string rejectionReason = "No fillable liquidity available for market buy";

                while (marketBid.remainingQuantity > 0)
                {
                    auto askIt = book.getLimitAsks().begin();
                    while (askIt != book.getLimitAsks().end() && askIt->userId == marketBid.userId)
                    {
                        ++askIt;
                    }

                    if (askIt == book.getLimitAsks().end())
                    {
                        rejectionReason = "No fillable liquidity available for market buy";
                        break;
                    }

                    Order limitAsk = *askIt;
                    const uint64_t askPrice = limitAsk.price.value();

                    if (askPrice == 0)
                    {
                        rejectionReason = "Invalid ask price while matching market buy";
                        break;
                    }

                    // Quantities and prices are micro-unit encoded.
                    // affordableMicroQty = budgetMicroDollars * MICRO_UNIT / priceMicroDollarsPerShare
                    uint64_t maxAffordableQuantity = static_cast<uint64_t>(
                        (static_cast<unsigned __int128>(remainingBudget) * MICRO_UNIT) / askPrice);

                    // Market buys should fill only whole shares (1 share == 1e6 micro-shares).
                    maxAffordableQuantity = (maxAffordableQuantity / MICRO_UNIT) * MICRO_UNIT;
                    if (maxAffordableQuantity == 0)
                    {
                        rejectionReason = "Estimated cost limit reached before remaining quantity could be filled";
                        break;
                    }

                    uint64_t filledQuantity = std::min(
                        marketBid.remainingQuantity,
                        std::min(limitAsk.remainingQuantity, maxAffordableQuantity));

                    // Enforce whole-share fills for market buys.
                    filledQuantity = (filledQuantity / MICRO_UNIT) * MICRO_UNIT;
                    if (filledQuantity == 0)
                    {
                        rejectionReason = "Estimated cost limit reached before remaining quantity could be filled";
                        break;
                    }

                    const uint64_t spent = static_cast<uint64_t>(
                        (static_cast<unsigned __int128>(filledQuantity) * askPrice) / MICRO_UNIT);

                    marketBid.remainingQuantity -= filledQuantity;
                    remainingBudget -= spent;
                    limitAsk.remainingQuantity -= filledQuantity;

                    book.eraseLimitAsk(askIt);

                    if (limitAsk.remainingQuantity > 0)
                        book.addAsk(limitAsk);

                    filledOrders.emplace_back(
                        marketBid.userId, limitAsk.userId,
                        marketBid.orderId, limitAsk.orderId,
                        marketBid.remainingQuantity, limitAsk.remainingQuantity,
                        ticker, filledQuantity, askPrice);
                }

                if (marketBid.remainingQuantity > 0)
                {
                    rejectedOrders.emplace_back(
                        marketBid.orderId,
                        marketBid.userId,
                        marketBid.ticker,
                        marketBid.side,
                        marketBid.remainingQuantity,
                        rejectionReason);
                }
            }
        }

        enqueueFills(filledOrders);
        enqueueRejections(rejectedOrders);
    }

    void matchWithIterators(OrderBook &book, std::set<Order, Order::CompareBids>::iterator bidIt, std::set<Order, Order::CompareAsks>::iterator askIt, std::vector<FilledOrder> &filledOrders)
    {
        // Make copies since we're about to erase
        Order bid = *bidIt;
        Order ask = *askIt;

        uint64_t filledPrice = (bid.timestamp < ask.timestamp)
                                 ? bid.price.value()  // bid was resting, fill at bid price
                                 : ask.price.value(); // ask was resting, fill at ask price

        uint64_t filledQuantity = std::min(bid.remainingQuantity, ask.remainingQuantity);
        bid.remainingQuantity -= filledQuantity;
        ask.remainingQuantity -= filledQuantity;

        filledOrders.emplace_back(
            bid.userId, ask.userId,
            bid.orderId, ask.orderId,
            bid.remainingQuantity, ask.remainingQuantity,
            bid.ticker, filledQuantity, filledPrice);

        // Erase and place back if not filled so depth map is updated 
        // Probably better to just manually call the updateLevels function and 
        // leave the orders in the book if they still have quantity to fill
        book.eraseLimitBid(bidIt);
        book.eraseLimitAsk(askIt);

        // Re-insert partials
        if (bid.remainingQuantity > 0)
            book.addBid(bid);
        if (ask.remainingQuantity > 0)
            book.addAsk(ask);
    }

    void matchLimitOrdersForTicker(const std::string &ticker)
    {
        std::vector<FilledOrder> filledOrders;
        auto [book, mutex] = getBookAndMutex(ticker);

        {
            std::lock_guard<std::mutex> lock(mutex);

            while (book.canFillLimitOrders())
            {
                auto bidIt = book.getLimitBids().begin();
                auto askIt = book.getLimitAsks().begin();

                // No price cross, done
                if (bidIt->price.value() < askIt->price.value()){
                    break;
                }

                // Prevent self-trade: walk the newer side to find valid counterparty
                if (bidIt->userId == askIt->userId)
                {
                    if (bidIt->timestamp < askIt->timestamp)
                    {
                        // bid is older, walk asks
                        while (askIt != book.getLimitAsks().end() && askIt->price.value() <= bidIt->price.value() && askIt->userId == bidIt->userId)
                        {
                            ++askIt;
                        }
                        if (askIt == book.getLimitAsks().end() || askIt->price.value() > bidIt->price.value()){
                            break;
                        }
                    }
                    else
                    {
                        // ask is older, walk bids
                        while (bidIt != book.getLimitBids().end() && bidIt->price.value() >= askIt->price.value() && bidIt->userId == askIt->userId)
                        {
                            ++bidIt;
                        }
                        if (bidIt == book.getLimitBids().end() || bidIt->price.value() < askIt->price.value()){
                            break;
                        }
                    }
                }
                matchWithIterators(book, bidIt, askIt, filledOrders);
            }
        }
        enqueueFills(filledOrders);
    }

    void matchMarketOrders()
    {
        for (int i = 0; i < std::size(TICKERS); i++)
        {
            matchMarketOrdersForTicker(TICKERS[i]);
        }
    }

    void matchLimitOrders()
    {
        for (int i = 0; i < std::size(TICKERS); i++)
        {
            matchLimitOrdersForTicker(TICKERS[i]);
        }
    }

    void publishAllDepths(Redis &redis, const std::unordered_map<std::string, uint64_t> &tickerPrices)
    {
        for (int i = 0; i < std::size(TICKERS); i++)
        {
            const auto t = TICKERS[i];
            auto [book, mutex] = getBookAndMutex(t);

            DepthSnapshot snap;
            {
                std::lock_guard<std::mutex> lock(mutex);
                snap = book.getDepth();
            }

            publishDepthForTicker(redis, t, snap, tickerPrices);
        }
    }
};

namespace OrderUtils
{
    void validateJson(const json &j)
    {
        if (!j.contains("id"))
            throw std::runtime_error("Missing id");
        if (!j.contains("userId"))
            throw std::runtime_error("Missing userId");
        if (!j.contains("ticker"))
            throw std::runtime_error("Missing ticker");
        if (!j.contains("side"))
            throw std::runtime_error("Missing side");
        if (!j.contains("price"))
            throw std::runtime_error("Missing price");
        if (!j.contains("type"))
            throw std::runtime_error("Missing type");
        if (!j.contains("quantity"))
            throw std::runtime_error("Missing quantity");
        if (!j.contains("timestamp"))
            throw std::runtime_error("Missing timestamp");
    }

    void addOrderToBook(MatchingEngine &engine, const json &j)
    {
        validateJson(j);
        Order order(j);

        if (order.orderType == OrderType::LIMIT)
        {
            engine.addLimitOrder(order);
        }
        else if (order.orderType == OrderType::MARKET)
        {
            engine.addMarketOrder(order);
        }
        // other order types here
    }

    void recoverFromRedis(MatchingEngine &engine, Redis &redis)
    {
        uint64_t limitOrders;
        uint64_t marketOrders;

        // Load all open orders from redis
        while (true)
        {
            auto result = redis.blpop("orders:recovery", 1);
            if (!result)
                break;

            auto [key, value] = *result;
            auto j = json::parse(value);

            std::string orderType = j["type"].get<std::string>();
            
            if (orderType == "LIMIT")
            {
                limitOrders++;
            }
            else if (orderType == "MARKET")
            {
                marketOrders++;
            }
            // other order types here - not strictly necessary, just for counting each type recovered

            addOrderToBook(engine, j);
        }

        std::cout << "recovered " << limitOrders << " limit orders and " << marketOrders << " market orders" << std::endl;
    }
}

int main()
{
    std::atomic<bool> running{true};
    std::atomic<bool> recoveryComplete{false};

    MatchingEngine engine;

    // Create a subscriber instance
    Redis redis("tcp://127.0.0.1:6379");
    auto sub = redis.subscriber();

    // Redis subscriber thread
    std::thread subscriberThread([&engine, &running, &recoveryComplete]()
                                 {
        try {
            Redis redis("tcp://127.0.0.1:6379");
            std::this_thread::sleep_for(std::chrono::seconds(10)); // wait for redis to contain recovered orders

            OrderUtils::recoverFromRedis(engine, redis);  
    
            recoveryComplete = true;
            
            auto sub = redis.subscriber();
            
            sub.on_message([&engine](std::string channel, std::string msg) {
            try {
                auto j = json::parse(msg);

                using namespace OrderUtils;
                
                if (channel == "orders:new") {
                    OrderUtils::addOrderToBook(engine, j);
                }
                else if (channel == "orders:cancel") {
                    
                    auto j = json::parse(msg);
                    
                    uint64_t orderId = j["orderId"].get<uint64_t>();
                    std::string ticker = j["ticker"].get<std::string>();
                    std::string side = j["side"].get<std::string>();

                    // Call cancelOrder with the extracted values
                    bool cancelled = engine.cancelOrder(orderId, ticker, side);
                }
                
            } catch (const std::exception& e) {
                std::cout << "Error: " << e.what() << std::endl;
            }
        });
            
            sub.subscribe("orders:new");
            sub.subscribe("orders:cancel");
            sub.subscribe("orders:recovery");
            
            std::cout << "Redis listener started" << std::endl;
            
            while (running) {
                try {
                    sub.consume();
                } catch (const Error& e) {
                    std::cerr << "Redis error: " << e.what() << std::endl;
                    std::this_thread::sleep_for(std::chrono::seconds(1));
                    }
                }
            } catch (const Error& e) {
            std::cerr << "Failed to connect to Redis: " << e.what() << std::endl;
        } });

    // Matching thread
    std::thread matchingThread([&engine, &running, &recoveryComplete]()
                               {
        
        while (!recoveryComplete) {
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
        }

        std::cout << "Matching engine started" << std::endl;
      
        while (running) {
        
            // process market orders first
            engine.matchMarketOrders();
            
            engine.matchLimitOrders(); 
            std::this_thread::sleep_for(std::chrono::milliseconds(5));
       
        } });

    // Publishing thread - depth, fills, cancel status updates
    std::thread publisherThread([&engine, &running, &recoveryComplete, &redis]()
                                {
                                    
    while (!recoveryComplete) {
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
    
    Redis publisherRedis("tcp://127.0.0.1:6379");
    
    std::unordered_map<std::string, uint64_t> tickerPrices;  

    while (running) {

        auto fills = engine.waitAndDrain(std::chrono::milliseconds(100), 150);

        if(fills.size()){
            json batch = json::array();
            for (const auto& fill : fills) {
                tickerPrices[fill.ticker] = fill.filledPrice;
                batch.push_back(fill.toJson());
            }
            publisherRedis.publish("orders:filled", batch.dump());
        }

        auto rejected = engine.drainRejected(1000);
        if (rejected.size()){
            json batch = json::array();
            for (const auto& r : rejected) batch.push_back(r.toJson());
            publisherRedis.publish("orders:rejected", batch.dump());
        }

        
        engine.publishAllDepths(publisherRedis, tickerPrices);
    } });

    std::cout << "Press Ctrl+C to stop..." << std::endl;
    std::cin.get();

    // The code below doesn't actually execute, ctrl+c just terminates the program immediately
    // Need to implement signal handler

    running = false;
    matchingThread.join();
    subscriberThread.join();
    publisherThread.join();

    std::cout << "Engine stopped" << std::endl;

    return 0;
}
