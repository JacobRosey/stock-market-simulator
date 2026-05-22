import { createServer } from 'http';
import { Server } from 'socket.io';

export function createWebsocketServer(app, {
    corsOptions,
    getEstimatedValueEntries,
    getLatestGeneratedNews,
    getLatestLeaderboard,
    broadcastLeaderboardUpdate,
    getDepth,
    verifyOrderOwnership,
    publishCancelOrder,
    onUserConnectionsChanged = () => {}
}) {
    const server = createServer(app);
    const io = new Server(server, {
        cors: corsOptions,
        transports: ['websocket', 'polling']
    });

    const userToSocket = new Map();
    const socketToUser = new Map();

    function notifyUserConnectionsChanged() {
        onUserConnectionsChanged(userToSocket.size);
    }

    function getAnotherSocketForUser(userId, disconnectedSocketId) {
        for (const [socketId, registeredUserId] of socketToUser.entries()) {
            if (registeredUserId !== userId || socketId === disconnectedSocketId) {
                continue;
            }

            const socket = io.sockets.sockets.get(socketId);
            if (socket?.connected) {
                return socket;
            }
        }

        return null;
    }

    io.on('connection', (socket) => {
        socket.on('register', (userId) => {
            const previousUserId = socketToUser.get(socket.id);
            if (previousUserId && previousUserId !== userId && userToSocket.get(previousUserId) === socket) {
                const replacementSocket = getAnotherSocketForUser(previousUserId, socket.id);
                if (replacementSocket) {
                    userToSocket.set(previousUserId, replacementSocket);
                } else {
                    userToSocket.delete(previousUserId);
                }
            }

            userToSocket.set(userId, socket);
            socketToUser.set(socket.id, userId);
            console.log(`User ${socketToUser.get(socket.id)} registered with socket ${userToSocket.get(userId).id}`);
            notifyUserConnectionsChanged();

            const latestGeneratedNews = getLatestGeneratedNews();
            if (latestGeneratedNews) {
                socket.emit('NEWS', latestGeneratedNews);
            }

            socket.emit('ESTIMATED_VALUE_UPDATE', Object.fromEntries(getEstimatedValueEntries()));

            const latestLeaderboard = getLatestLeaderboard();
            if (latestLeaderboard.length > 0) {
                socket.emit('LEADERBOARD_UPDATE', latestLeaderboard);
            } else {
                void broadcastLeaderboardUpdate();
            }
        });

        socket.on('subscribe', (ticker) => {
            const rooms = Array.from(socket.rooms);
            rooms.forEach(room => {
                if (room.startsWith('ticker:')) {
                    socket.leave(room);
                }
            });

            socket.join(`ticker:${ticker}`);

            const cachedDepth = getDepth(ticker);
            if (cachedDepth) {
                socket.emit('depth', {
                    ...cachedDepth,
                    ticker: ticker
                });
            }
        });

        socket.on('cancel-order', async (data) => {
            try {
                const userId = socketToUser.get(socket.id);
                if (!userId) {
                    console.log("Something very weird happened with a cancel-order websocket message!");
                    return socket.emit('error', 'Not authenticated');
                }

                const result = await verifyOrderOwnership(data.orderId);

                if (result.user_id !== userId) {
                    return socket.emit('error', 'Not your order');
                }
                if (!['OPEN', 'PARTIALLY_FILLED'].includes(result.status)) {
                    return socket.emit('error', 'Order is already filled or cancelled');
                }

                data.userId = userId;
                await publishCancelOrder(data);
                socket.emit('order-cancelling', { orderId: data.orderId });
            } catch (error) {
                console.error('Cancel error:', error);
                socket.emit('error', 'Failed to cancel order');
            }
        });

        socket.on('disconnect', () => {
            const userId = socketToUser.get(socket.id);
            if (userToSocket.get(userId) === socket) {
                const replacementSocket = getAnotherSocketForUser(userId, socket.id);
                if (replacementSocket) {
                    userToSocket.set(userId, replacementSocket);
                } else {
                    userToSocket.delete(userId);
                }
                notifyUserConnectionsChanged();
            }
            socketToUser.delete(socket.id);
        });

        socket.on('connect_error', (error) => {
            console.log('Connection error:', error);
        });
    });

    function listen(port) {
        server.listen(port, () => {
            console.log(`HTTP and websocket server running on port ${port}`);
        });
    }

    return {
        io,
        server,
        userToSocket,
        socketToUser,
        listen
    };
}
