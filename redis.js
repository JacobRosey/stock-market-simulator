import Redis from 'ioredis';

export async function createRedisLayer({
    tickers,
    io,
    depthCache,
    convertDepth,
    cancelOrderInDatabase,
    enqueueFillTrades,
    normalizeRejectedOrdersPayload,
    applyOrderRejectionToDatabase,
    toNormalUnits,
    userToSocket,
    getBotManager
}) {
    const redisClient = new Redis();
    const publisher = redisClient.duplicate();
    const subscriber = redisClient.duplicate();

    await subscriber.subscribe('orders:filled');
    await subscriber.subscribe('orders:rejected');
    await subscriber.subscribe('orders:cancel');

    for (const ticker of tickers) {
        await subscriber.subscribe(`orders:depth:${ticker}`);
        console.log(`Subscribed to orders:depth:${ticker}`);
    }

    subscriber.on('message', async (channel, message) => {
        if (channel.startsWith('orders:depth:')) {
            const ticker = channel.replace('orders:depth:', '');

            try {
                const depth = JSON.parse(message);
                const cached = depthCache.get(ticker);
                const convertedDepth = convertDepth(depth);
                const effectivePrice = convertedDepth.lastPrice > 0
                    ? convertedDepth.lastPrice
                    : (cached?.lastPrice || 0);
                const finalDepth = {
                    ...convertedDepth,
                    lastPrice: effectivePrice
                };

                if (!cached || JSON.stringify(cached) !== JSON.stringify(finalDepth)) {
                    depthCache.set(ticker, finalDepth);
                    io.to(`ticker:${ticker}`).emit('depth', {
                        ...finalDepth,
                        ticker: ticker
                    });
                }
            } catch (e) {
                console.error('Failed to parse depth:', e);
            }
        }

        if (channel == "orders:cancel") {
            try {
                const data = JSON.parse(message);
                await cancelOrderInDatabase(data.orderId);
                getBotManager()?.onOrderCanceled(data.orderId);
            } catch (e) {
                console.error(e);
            }
        }

        if (channel === 'orders:filled') {
            try {
                const trades = JSON.parse(message);
                getBotManager()?.onTrades(trades);
                enqueueFillTrades(trades);
            } catch (err) {
                console.error('Failed to parse orders:filled payload:', err);
            }
        }

        if (channel == 'orders:rejected') {
            try {
                const parsed = JSON.parse(message);
                const rejectedOrders = normalizeRejectedOrdersPayload(parsed);
                console.log("Rejected orders: ", rejectedOrders.length);
                for (const rejected of rejectedOrders) {
                    const orderStatus = await applyOrderRejectionToDatabase(rejected);
                    getBotManager()?.onOrderRejected(rejected);

                    const socket = userToSocket.get(rejected.userId);
                    socket?.emit('ORDER_REJECTED', {
                        orderId: rejected.orderId,
                        userId: rejected.userId,
                        ticker: rejected.ticker,
                        side: rejected.side,
                        rejectedQuantity: toNormalUnits(rejected.rejectedQuantity),
                        reason: rejected.reason,
                        timestamp: rejected.timestamp,
                        status: 'REJECTED',
                        orderStatus: orderStatus ?? 'REJECTED'
                    });
                }
            } catch (err) {
                console.error('Failed to process orders:rejected payload:', err);
            }
        }
    });

    return {
        redisClient,
        publisher,
        subscriber
    };
}
