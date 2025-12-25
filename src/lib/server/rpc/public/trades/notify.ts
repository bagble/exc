import { z } from "zod";
import { authOnlyORPCMiddleware, rateLimitORPCMiddleware } from "$lib/server/middlewares/orpc.auth.middleware";
import { getOrderNotify, getOrderNotifySize } from "$lib/server/redis/presets/notify";
import { rpcBuilder } from "$lib/server/middlewares/orpc.builder";

const orderNotifyData = z.object({
    timestamp: z.number().int().nonnegative(),
    message_id: z.string().min(1),
    user_id: z.number().int().nonnegative(),
    order_id: z.string().min(1),
    symbol: z.string().min(1).trim().toUpperCase().regex(/^[ A-Z0-9]+$/, "Symbol must be uppercase alphanumeric"),
    side: z.enum(["buy", "sell"]),
    type: z.enum(["limit", "market", "stop", "stop_limit"]),
    price: z.number().nonnegative(),
    quantity: z.number().nonnegative(),
    status: z.enum(["open", "modified", "cancelled", "filled", "partially_filled"]),
});

const fetchOrderNotifySchema = z.object({
    user_id: z.number().int().nonnegative(),
    page: z.number().min(1).default(1),
    pageSize: z.number().min(1).max(100).default(100)
});

// TODO: redis에 없거나 부족한 데이터는 postgresql 시계열 데이터베이스에서 가져오기
/**
 * 특정 사용자의 주문 알림을 페이지네이션하여 가져옵니다.
 * - 인증된 사용자만 접근 가능
 * - Rate Limit: 1분당 100회
 * @param user_id 사용자 ID
 * @param page 페이지 번호 (기본값: 1)
 * @param pageSize 페이지당 알림 수 (기본값: 100, 최대값: 100)
 * @returns `{ notify: [ { timestamp, message_id, user_id, order_id, symbol, side, type, price, quantity, status }, ... ], pagination: { page, pageSize, total, totalPages } }` - 내림차순으로 정렬된 주문 알림 배열과 페이지네이션 정보
 */
export const fetchOrderNotify = rpcBuilder
    .use(authOnlyORPCMiddleware)
    .use(rateLimitORPCMiddleware(100, 60, "", true)) // 1분당 100회로 제한 (인증된 사용자만)
    .input(fetchOrderNotifySchema)
    .handler(async ({input}) => {
        const notify = await getOrderNotify(input.user_id, input.page * input.pageSize); // pageSize * page 만큼 가져오기
        const notifySlice = notify.slice((input.page - 1) * input.pageSize, input.page * input.pageSize) // 해당 페이지에 맞게 자르기
        const total = await getOrderNotifySize(input.user_id);

        return {
            notify: notifySlice as z.infer<typeof orderNotifyData>[],
            pagination: {
                page: input.page,
                pageSize: input.pageSize,
                total: total,
                totalPages: Math.ceil(total as number / input.pageSize)
            }
        };
    });