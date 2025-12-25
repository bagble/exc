import { redis } from "$lib/server/redis/db";
import type { ChainableCommander } from "ioredis";

type ledgerType = {
    timestamp: number,
    symbol: string,
    price: number,
    volume: number,
    side: "buy" | "sell",
    buyer_order_id: string,
    seller_order_id: string,
    execution_id: string,
    conditions: string,
    sequence: number,
    cumulativeVolume: number,
    change: number
};

/**
 * 체결내역 상위 top개 가져오기
 * 시간 복잡도: O(log(N)+M) (N: 스트림 길이, M: 가져올 개수)
 * @param symbol - 심볼
 * @param top - 상위 개수
 * @returns `{Promise<ledgerType[]>}` 체결내역 배열
 */
export async function getLedger(symbol: string, top: number) { // 체결내역 상위 top개 가져오기 [{ledgerType}, ...]
    if (top <= 0) {
        return [] as ledgerType[];
    }

    const entries = await redis.xrevrange(`symbol:${symbol}:ledger`, '+', '-', 'COUNT', top);

    if (entries.length === 0) return [] as ledgerType[];

    return entries.map(([_, fields]) => {
        const data = Object.fromEntries(
            Array.from({length: fields.length / 2}, (_, i) => [fields[i * 2], fields[i * 2 + 1]])
        );

        return {
            timestamp: parseInt(data.timestamp),
            symbol: data.symbol,
            price: parseFloat(data.price),
            volume: parseFloat(data.volume),
            side: data.side,
            buyer_order_id: data.buyer_order_id,
            seller_order_id: data.seller_order_id,
            execution_id: data.execution_id,
            conditions: data.conditions,
            sequence: parseInt(data.sequence),
            cumulativeVolume: parseFloat(data.cumulativeVolume),
            change: parseFloat(data.change)
        } as ledgerType;
    });
}

/**
 * 체결내역 개수 가져오기
 * 시간 복잡도: O(1)
 * @param symbol - 심볼
 * @returns `{Promise<number>}` 체결내역 개수
 */
export async function getLedgerSize(symbol: string) { // 체결내역 개수 가져오기
    return redis.xlen(`symbol:${symbol}:ledger`);
}

// TODO: postgresql 시계열 데이터베이스에 '체결 데이터' 저장하기
/**
 * 체결내역 추가
 * 시간 복잡도: O(1)
 * @param symbol - 심볼
 * @param data - 체결내역 데이터
 * @param pipeline - Redis 파이프라인 (optional)
 */
export function addLedger(symbol: string, data: ledgerType, pipeline?: ChainableCommander) {
    if (pipeline) {
        pipeline.xadd(`symbol:${symbol}:ledger`, '*',
            'timestamp', data.timestamp.toString(),
            'symbol', data.symbol,
            'price', data.price.toString(),
            'volume', data.volume.toString(),
            'side', data.side,
            'buyer_order_id', data.buyer_order_id,
            'seller_order_id', data.seller_order_id,
            'execution_id', data.execution_id,
            'conditions', data.conditions,
            'sequence', data.sequence.toString(),
            'cumulativeVolume', data.cumulativeVolume.toString(),
            'change', data.change.toString());
    } else {
        redis.xadd(`symbol:${symbol}:ledger`, '*',
            'timestamp', data.timestamp.toString(),
            'symbol', data.symbol,
            'price', data.price.toString(),
            'volume', data.volume.toString(),
            'side', data.side,
            'buyer_order_id', data.buyer_order_id,
            'seller_order_id', data.seller_order_id,
            'execution_id', data.execution_id,
            'conditions', data.conditions,
            'sequence', data.sequence.toString(),
            'cumulativeVolume', data.cumulativeVolume.toString(),
            'change', data.change.toString()).then(r => r).catch(e => {
            console.error(`Failed to add ledger data to Redis: ${e}`);
        });
    }

    return;
}