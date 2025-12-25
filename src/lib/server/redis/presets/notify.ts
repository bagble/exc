import type { OrderStatus } from "$lib/server/ProcessOrder";
import { redis } from "$lib/server/redis/db";
import { logger } from "../../../../utils/logger";
import type { ChainableCommander } from "ioredis";

type orderNotifyType = {
    timestamp: number,
    message_id: string,
    user_id: number,
    order_id: string,
    symbol: string,
    side: "buy" | "sell",
    type: "limit" | "market" | "stop" | "stop_limit",
    price: number,
    quantity: number,
    status: OrderStatus
};

/**
 * 유저의 최신 주문 알림 top개 가져오기
 * 시간 복잡도: O(log(N)+M) (N: 스트림 길이, M: 가져올 개수)
 * @param user_id - 유저 ID
 * @param top - 가져올 알림 개수
 * @returns 주문 알림 배열
 */
export async function getOrderNotify(user_id: number, top: number) {
    if (top <= 0) {
        return [];
    }

    const entries = await redis.xrevrange(`user:${user_id}:notify:orders`, '+', '-', 'COUNT', top);

    if (entries.length === 0) return [];

    return entries.map(([_, fields]) => {
        const data = Object.create(null);
        for (let i = 0; i < fields.length; i += 2) {
            data[fields[i]] = fields[i + 1];
        }
        return {
            timestamp: Number(data.timestamp),
            message_id: data.message_id,
            user_id: Number(data.user_id),
            order_id: data.order_id,
            symbol: data.symbol,
            side: data.side,
            type: data.type,
            price: Number(data.price),
            quantity: Number(data.quantity),
            status: data.status
        };
    });
}

/**
 * 유저의 주문 알림 개수 가져오기
 * 시간 복잡도: O(1)
 * @param user_id - 유저 ID
 * @returns 주문 알림 개수
 */
export async function getOrderNotifySize(user_id: number) { // 유저 알림 개수 가져오기
    return redis.xlen(`user:${user_id}:notify:orders`);
}

// TODO: postgresql 시계열 데이터베이스에 '유저 알림 목록' 저장하기
/**
 * 유저의 주문 알림 추가하기
 * 시간 복잡도: O(1)
 * @description Redis 스트림과 SSE를 사용하여 실시간 알림 전송
 * @param user_id
 * @param data
 * @param pipeline
 */
export function addOrderNotify(user_id: number, data: orderNotifyType, pipeline?: ChainableCommander) {
    if (pipeline) {
        pipeline.xadd(`user:${user_id}:notify:orders`, '*',
            'timestamp', data.timestamp.toString(),
            'message_id', data.message_id,
            'user_id', data.user_id.toString(),
            'order_id', data.order_id,
            'symbol', data.symbol,
            'side', data.side,
            'type', data.type,
            'price', data.price.toString(),
            'quantity', data.quantity.toString(),
            'status', data.status);
    } else {
        redis.xadd(`user:${user_id}:notify:orders`, '*',
            'timestamp', data.timestamp.toString(),
            'message_id', data.message_id,
            'user_id', data.user_id.toString(),
            'order_id', data.order_id,
            'symbol', data.symbol,
            'side', data.side,
            'type', data.type,
            'price', data.price.toString(),
            'quantity', data.quantity.toString(),
            'status', data.status).catch(e => {
            logger.error(`Failed to add order notification to Redis: ${e}`);
        });
    }

    return;
}