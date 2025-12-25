import { redis } from "$lib/server/redis/db";

/**
 * Redis 내에 저장된 모든 캐시를 삭제합니다.
 * 시간 복잡도: O(N) - N은 삭제할 키의 개수입니다.
 * 삭제 대상 키 패턴:
 * - symbol:*
 * - ledger:*
 * - user:*:orders
 * @returns `{Promise<{success: boolean, message: string, error?: any}>}` 캐시 삭제 결과
 */
export async function clearAllCaches() {
    try {
        const symbolCache = await redis.keys('symbol:*');
        const filteredSymbolCache = symbolCache.filter(
            key => !/^symbol:.*:.*:(open|high|low|close|volume|price|charts)$/.test(key) // 캔들 데이터는 삭제하지 않음
        );
        if (filteredSymbolCache.length > 0) {
            await redis.del(...filteredSymbolCache);
        }

        const ledgerCache = await redis.keys('ledger:*');
        if (ledgerCache.length > 0) {
            await redis.del(...ledgerCache);
        }

        const userOrderCache = await redis.keys('user:*:orders');
        if (userOrderCache.length > 0) {
            await redis.del(...userOrderCache);
        }
        return {success: true, message: 'All caches cleared successfully.'};
    } catch (error) {
        return {success: false, message: 'Error clearing caches.', error};
    }
}