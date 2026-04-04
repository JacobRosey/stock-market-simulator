// OrderBook.tsx
import { useState, useEffect } from 'react';
import { placeOrder } from '../../../api';
import type { Order, OrderRequestData, OrderSide, OrderType, Ticker } from '../../../types';
import { useWebSocket } from '../../../context/WebSocketContext';
import './orderbook.css'

interface OrderBookProps {
  selectedTicker: string;
}

// Displays current orderbook depth using data from websockets
// and provides form for market/limit order placement
export default function OrderBook({ selectedTicker }: OrderBookProps) {

  const [orderType, setOrderType] = useState<OrderType>('MARKET');

  const [limitPrice, setLimitPrice] = useState<string>('');
  const [quantity, setQuantity] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const { getDepthForTicker, subscribeToTicker, addOrder, isConnected } = useWebSocket();
  const depth = getDepthForTicker(selectedTicker as Ticker);

  // Set default values for initial page load 
  const asks = depth?.asks ?? Array.from({ length: 3 }, () => ({ price: 0, quantity: 0 }));
  const bids = depth?.bids ?? Array.from({ length: 3 }, () => ({ price: 0, quantity: 0 }));
  const bestAsk = Math.min(...asks.map(a => a.price));
  const bestBid = Math.max(...bids.map(b => b.price));
  const spread = bestAsk - bestBid;
  const assetPrice = depth?.lastPrice || (bestAsk + bestBid) / 2;
  const spreadPercent = assetPrice > 0 ? (spread / assetPrice) * 100 : 0;


  useEffect(() => {
    if (!selectedTicker) return;

    const attemptSubscription = () => {
      if (isConnected) {
        subscribeToTicker(selectedTicker as Ticker);
      } else {
        // Try again in 1 second - mostly just to handle initial app start
        // when client connects before any order depth exists 
        setTimeout(attemptSubscription, 1000);
      }
    };

    attemptSubscription();

  }, [selectedTicker, isConnected]);

  const formatPrice = (price: number) => price.toFixed(2);
  const formatSize = (quantity: number) => quantity.toString();

  const handleOrder = async (orderSide: OrderSide) => {

    if (!quantity || parseInt(quantity) <= 0) {
      setError('Please enter a valid quantity');
      return;
    }

    if (orderType === 'LIMIT' && (!limitPrice || parseFloat(limitPrice) <= 0)) {
      setError('Please enter a valid price');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const orderData: OrderRequestData = {
        ticker: selectedTicker as Ticker,
        side: orderSide as OrderSide,
        type: orderType as OrderType,
        quantity: parseFloat(quantity)
      };

      if (orderType === 'LIMIT') {
        orderData.price = parseFloat(limitPrice);
      }

      const response = await placeOrder(orderData);
      if (!response.success) {
        setError(response.message)
      } else {
        console.log(`order placed successfully: `, response)
        const result = await response;


        const newOrder: Order = {
          orderId: result.orderId,
          userId: result.userId,
          ticker: result.ticker,
          side: result.side,
          type: result.type,
          price: result.price,
          quantity: result.quantity,
          filledQuantity: 0,
          remainingQuantity: result.quantity,
          status: 'OPEN',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          estimatedAmount: result.estimatedAmount,
          filledPrice: 0
        };

        addOrder(newOrder);


        setSuccess(response.message);
      }

      setQuantity('');
      setLimitPrice("");

      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(null), 3000);

    } catch (err: any) {
      setError(err.message || 'Failed to place order');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="order-book">
      <div className="order-book-header">
        <h3>Order Book - {selectedTicker}</h3>
      </div>

      {/* Asks (Sell Orders) */}
      <div className="order-book-asks">
        <div className="order-book-headers">
          <span>Price</span>
          <span>Size</span>
        </div>
        {asks.map((ask, i) => (
          <div key={`ask-${i}`} className="order-book-row ask">
            <span className="price">{formatPrice(ask.price)}</span>
            <span className="size">{formatSize(ask.quantity)}</span>
          </div>
        ))}
      </div>

      <div className="order-book-spread">
        <span>Spread: ${formatPrice(spread)} ({spreadPercent.toFixed(2)}%)</span>
      </div>

      <div className="order-book-bids">
        {bids.map((bid, i) => (
          <div key={`bid-${i}`} className="order-book-row bid">
            <span className="price">{formatPrice(bid.price)}</span>
            <span className="size">{formatSize(bid.quantity)}</span>
          </div>
        ))}
      </div>

      <div className="trading-form">
        <div className="order-type-selector">
          <button
            className={`type-btn ${orderType === 'MARKET' ? 'active' : ''}`}
            onClick={() => setOrderType('MARKET')}
          >
            Market
          </button>
          <button
            className={`type-btn ${orderType === 'LIMIT' ? 'active' : ''}`}
            onClick={() => setOrderType('LIMIT')}
          >
            Limit
          </button>
        </div>

        {orderType === 'LIMIT' && (
          <div className="input-group">
            <label>Price ($)</label>
            <input
              type="number"
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              placeholder={assetPrice ? assetPrice.toFixed(2) : "0.00"}
              step="0.01"
              min="0.01"
              disabled={isSubmitting}
            />
          </div>
        )}

        <div className="input-group">
          <label>Quantity</label>
          <input
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="0"
            min="1"
            step="1"
            disabled={isSubmitting}
          />
        </div>

        {error && <div className="order-error">{error}</div>}
        {success && <div className="order-success">{success}</div>}

        <div className="order-buttons">
          <button
            className="buy-btn"
            onClick={() => handleOrder('BUY')}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Placing...' : `Buy ${selectedTicker}`}
          </button>
          <button
            className="sell-btn"
            onClick={() => handleOrder('SELL')}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Placing...' : `Sell ${selectedTicker}`}
          </button>
        </div>

        {orderType === 'LIMIT' && limitPrice && quantity && (
          <div className="order-total">
            Total: ${(parseFloat(limitPrice) * parseFloat(quantity)).toFixed(4)}
          </div>
        )}
      </div>
    </div>
  );
}