import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { fileURLToPath } from 'url';

dotenv.config();

const DEFAULT_RETENTION_HOURS = 24;
const TERMINAL_ORDER_STATUSES = ['FILLED', 'CANCELED', 'CANCELLED', 'REJECTED'];

function getRetentionHours() {
    const value = Number(process.env.MARKET_DATA_RETENTION_HOURS ?? DEFAULT_RETENTION_HOURS);
    if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`MARKET_DATA_RETENTION_HOURS must be a positive number. Found: ${process.env.MARKET_DATA_RETENTION_HOURS}`);
    }
    return value;
}

function createDbConnection() {
    return mysql.createConnection({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
    });
}

async function deleteOldPriceHistory(connection, retentionHours) {
    const [result] = await connection.query(
        `DELETE FROM price_history
         WHERE timestamp < TIMESTAMPADD(HOUR, -?, NOW())`,
        [retentionHours]
    );

    return result.affectedRows ?? 0;
}

async function deleteOldBotOrders(connection, retentionHours) {
    const [result] = await connection.query(
        `DELETE o
         FROM orders o
         INNER JOIN users u ON u.user_id = o.user_id
         WHERE u.username LIKE 'bot\\_%'
         AND o.status IN (?)
         AND o.updated_at < TIMESTAMPADD(HOUR, -?, NOW())`,
        [TERMINAL_ORDER_STATUSES, retentionHours]
    );

    return result.affectedRows ?? 0;
}

export async function pruneOldMarketData() {
    const retentionHours = getRetentionHours();
    const connection = await createDbConnection();

    try {
        await connection.beginTransaction();

        const priceHistoryDeleted = await deleteOldPriceHistory(connection, retentionHours);
        const botOrdersDeleted = await deleteOldBotOrders(connection, retentionHours);

        await connection.commit();

        return {
            retentionHours,
            priceHistoryDeleted,
            botOrdersDeleted,
        };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        await connection.end();
    }
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
    pruneOldMarketData()
        .then((result) => {
            console.log('Old market data prune completed.');
            console.log(`Retention hours: ${result.retentionHours}`);
            console.log(`Price history rows deleted: ${result.priceHistoryDeleted}`);
            console.log(`Bot order rows deleted: ${result.botOrdersDeleted}`);
        })
        .catch((error) => {
            console.error('Old market data prune failed.');
            console.error(error);
            process.exitCode = 1;
        });
}
