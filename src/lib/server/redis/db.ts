import Redis from 'ioredis';
import { env } from "$env/dynamic/private";
import { logger } from "../../../utils/logger";

export const redis = new Redis({
    host: env.REDIS_HOST,
    port: parseInt(env.REDIS_PORT),
    username: env.REDIS_USERNAME,
    password: env.REDIS_PASSWORD,
    db: parseInt(env.REDIS_DB),
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    enableOfflineQueue: true,
    lazyConnect: false,
    keepAlive: 30000,
    tls: env.REDIS_TLS === 'true' ? { rejectUnauthorized: false } : undefined,
    // 클러스터 모드 지원
    connectionName: `PJSe-${env.ID}`,
    retryStrategy: (times) => {
        return Math.min(times * 50, 2000);
    },
    reconnectOnError: (err) => {
        const targetError = 'READONLY';
        return err.message.includes(targetError);
    },
});

/**
 * Redis 초기화 함수
 */
export async function initRedis() {
    if (await pingRedis()) {
        logger.info('Connected to Redis');
        return;
    }
    logger.error('Failed to connect to Redis');
}

/**
 * Redis 핑 함수
 * @returns {Promise<boolean>} - 핑 성공 여부
 */
export async function pingRedis(): Promise<boolean> {
    try {
        const pong = await redis.ping();
        return pong === 'PONG';
    } catch (error) {
        logger.error('Error pinging Redis:', error);
        return false;
    }
}

/**
 * Redis 연결 종료 함수
 */
export function closeRedis() {
    try {
        redis.disconnect();
        logger.info('Disconnected from Redis');
    } catch (error) {
        logger.error('Error disconnecting from Redis:', error);
    }
}