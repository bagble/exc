import { z } from "zod";
import { rateLimitORPCMiddleware } from "$lib/server/middlewares/orpc.auth.middleware";
import { getLedger, getLedgerSize } from "$lib/server/redis/presets/ledger";
import { rpcBuilder } from "$lib/server/middlewares/orpc.builder";

const ledgerData = z.object({
    timestamp: z.number().int().nonnegative(),
    symbol: z.string().min(1).trim().toUpperCase().regex(/^[A-Z0-9]+$/, "Symbol must be uppercase alphanumeric"),
    price: z.number().nonnegative(),
    volume: z.number().nonnegative(),
    side: z.enum(["buy", "sell"]),
    buyer_order_id: z.string().min(1),
    seller_order_id: z.string().min(1),
    execution_id: z.string().min(1),
    conditions: z.string().min(0),
    sequence: z.number().int().nonnegative(),
    cumulativeVolume: z.number().nonnegative()
});

const fetchLedgerSchema = z.object({
    symbol: z.string().min(1).trim().toUpperCase().regex(/^[A-Z0-9]+$/, "Symbol must be uppercase alphanumeric"),
    page: z.number().min(1).default(1),
    pageSize: z.number().min(1).max(100).default(100)
});

// TODO: redis에 없거나 부족한 데이터는 postgresql 시계열 데이터베이스에서 가져오기
/**
 * 체결 내역을 페이징하여 가져옵니다.
 * - Rate Limit: 1분당 100회
 * @param symbol 심볼 (예: "NVDA")
 * @param page 페이지 번호 (기본값: 1)
 * @param pageSize 페이지당 항목 수 (기본값: 100, 최대값: 100)
 * @returns `{ ledger: [ { timestamp, symbol, price, volume, side, buyer_order_id, seller_order_id, execution_id, conditions, sequence, cumulativeVolume }, ... ], pagination: { page, pageSize, total, totalPages } }` - 내림차순으로 정렬된 체결 내역 배열과 페이징 정보
 */
export const fetchLedger = rpcBuilder
    .use(rateLimitORPCMiddleware(100, 60)) // 1분당 100회로 제한
    .input(fetchLedgerSchema)
    .handler(async ({input}) => {
        const ledger = await getLedger(input.symbol, input.page * input.pageSize); // pageSize * page 만큼 가져오기
        const ledgerSlice = ledger.slice((input.page - 1) * input.pageSize, input.page * input.pageSize) // 해당 페이지에 맞게 자르기
        const total = await getLedgerSize(input.symbol);

        return {
            ledger: ledgerSlice as z.infer<typeof ledgerData>[],
            pagination: {
                page: input.page,
                pageSize: input.pageSize,
                total: total,
                totalPages: Math.ceil(total as number / input.pageSize)
            }
        };
    });