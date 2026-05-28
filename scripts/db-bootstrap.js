import fs from 'fs/promises';
import path from 'path';
import mysql from 'mysql2/promise';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const schemaDir = path.join(__dirname, '..', 'schema');

function getRequiredDbName() {
    const databaseName = process.env.DB_NAME;

    if (!databaseName) {
        throw new Error('DB_NAME is required.');
    }

    return databaseName;
}

function escapeIdentifier(identifier) {
    return `\`${String(identifier).replaceAll('`', '``')}\``;
}

function stripDatabaseSelection(sql) {
    return sql
        .split('\n')
        .filter(line => !/^\s*(CREATE\s+DATABASE|USE)\b/i.test(line))
        .join('\n');
}

function splitSqlStatements(sql) {
    return sql
        .split(';')
        .map(statement => statement.trim())
        .filter(Boolean);
}

async function runSqlFile(connection, filename) {
    const sql = await fs.readFile(path.join(schemaDir, filename), 'utf8');
    const statements = splitSqlStatements(stripDatabaseSelection(sql));

    for (const statement of statements) {
        await connection.query(statement);
    }
}

export async function ensureDatabaseReady() {
    const databaseName = getRequiredDbName();
    const serverConnection = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
    });

    try {
        await serverConnection.query(
            `CREATE DATABASE IF NOT EXISTS ${escapeIdentifier(databaseName)}`
        );
    } finally {
        await serverConnection.end();
    }

    const databaseConnection = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: databaseName,
    });

    try {
        await runSqlFile(databaseConnection, 'create-tables.sql');
        await runSqlFile(databaseConnection, 'seed-stocks.sql');
    } finally {
        await databaseConnection.end();
    }
}
