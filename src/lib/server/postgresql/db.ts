import postgres from 'postgres';
import { env } from "$env/dynamic/private";
import { logger } from "../../../utils/logger";
import { type EXC } from '../loader/loader';

const encodedPassword = encodeURIComponent(env.POSTGRESQL_PASSWORD);
const dbUrl = `postgres://${env.POSTGRESQL_USER}:${encodedPassword}@${env.POSTGRESQL_HOST}:${env.POSTGRESQL_PORT}/${env.POSTGRESQL_NAME}`;

const msToSec = (v?: number) => v ? Math.max(1, Math.ceil(v / 1000)) : undefined;

/**
 * PostgreSQL 클라이언트
 */
export const postgresClient = postgres(dbUrl, {
    max: Number(env.POSTGRESQL_MAX_CONNS) || 10,
    idle_timeout: msToSec(Number(env.POSTGRESQL_CONN_MAX_IDLE_TIME) || 10000),
    max_lifetime: msToSec(Number(env.POSTGRESQL_CONN_MAX_LIFETIME) || 60000),
    ssl: env.POSTGRESQL_SSL === 'disable' ? false : env.POSTGRESQL_SSL as "require" | "prefer" | "allow" | "verify-full",
});

/**
 * PostgreSQL 초기화
 */
export async function initPostgres(): Promise<void> {
    const exchange = (globalThis as any).exchange as EXC;

    try {
        await postgresClient`SELECT 1`;
        logger.info('Connected to PostgreSQL');

        await postgresClient`select set_config('TimeZone', ${exchange.default_timezone}, true)`;
        logger.info(`PostgreSQL timezone set to ${exchange.default_timezone}`);
    } catch (error) {
        logger.error('PostgreSQL connection error:', error);
        throw error;
    }
}

/**
 * PostgreSQL 연결 테스트
 */
export async function pingPostgres(): Promise<boolean> {
    try {
        await postgresClient`SELECT 1`;
        return true;
    } catch (error) {
        logger.error('PostgreSQL ping error:', error);
        return false;
    }
}

/**
 * PostgreSQL 연결 종료
 */
export async function closePostgres(): Promise<void> {
    try {
        await postgresClient.end({timeout: 5});
        logger.info('PostgreSQL connection closed');
    } catch (e) {
        logger.error('PostgreSQL close error:', e);
    }
}