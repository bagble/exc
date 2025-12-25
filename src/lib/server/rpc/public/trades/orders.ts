import { z } from "zod";
import { authOnlyORPCMiddleware } from "$lib/server/middlewares/orpc.auth.middleware";
import { OrderStatus, preprocess } from "$lib/server/ProcessOrder";
import { getOrder, getUserOrders } from "$lib/server/redis/presets/depth";
import { rpcBuilder } from "$lib/server/middlewares/orpc.builder";
import { tradableOrderMiddleware } from "$lib/server/middlewares/orpc.order.middleware";

const DefaultOrderSchema = z.object({
    timestamp: z.number().int().nonnegative(),
    user_id: z.number().int().nonnegative(),
    order_id: z.string().min(1),
    symbol: z.string().min(1).trim().toUpperCase().regex(/^[A-Z0-9]+$/, "Symbol must be uppercase alphanumeric"),
    status: z.enum(["open", "modified", "cancelled", "filled", "partially_filled"]),
    side: z.enum(["buy", "sell"]),
    type: z.enum(["market", "limit", "stop", "stop_limit"]),
    price: z.number().nonnegative(),
    quantity: z.number().positive(),
    market_order_slippage_price: z.number().nonnegative().optional(),
    market_order_slippage_percent: z.number().nonnegative().optional(),
    market_order_type: z.enum(["IOC", "FOK"]).optional(),
});

export const CreateOrderSchema = DefaultOrderSchema.pick({
    symbol: true,
    side: true,
    type: true,
    price: true,
    quantity: true,
    market_order_slippage_price: true,
    market_order_slippage_percent: true,
    market_order_type: true,
});

export const ModifyOrderSchema = DefaultOrderSchema.pick({
    symbol: true,
    order_id: true,
    type: true,
    price: true,
    quantity: true,
    market_order_slippage_price: true,
    market_order_slippage_percent: true,
    market_order_type: true,
}).partial().required({order_id: true, symbol: true});

export const CancelOrderSchema = DefaultOrderSchema.pick({
    symbol: true,
    order_id: true,
});


/**
 * 사용자의 모든 주문을 반환합니다.
 * 사용하는 context: context.user.id
 * @returns `{ symbol: string; order_id: string; side: "buy" | "sell"; price: number; quantity: number; timestamp: number }[]` - 사용자의 모든 주문 목록
 */
export const getOrders = rpcBuilder
    .use(authOnlyORPCMiddleware)
    .handler(async ({context}) => {
        const orders = await getUserOrders(context.user!.id.toString());
        if (!orders) {
            return [];
        }

        const orderPromises = Object.entries(orders).map(async ([symbol, order_id]) => {
            const order = await getOrder(symbol, order_id);
            if (!order) return null;

            return {
                symbol,
                order_id,
                side: order.side,
                price: order.price,
                quantity: order.quantity,
                timestamp: order.timestamp
            };
        });

        return await Promise.all(orderPromises);
    });

/**
 * 사용자가 요청한 주문을 생성합니다.
 * 사용하는 context: context.user.id
 * @param symbol 심볼 (예: "NVDA")
 * @param side 주문의 방향 ("buy" 또는 "sell")
 * @param type 주문의 유형 ("market", "limit", "stop", "stop_limit")
 * @param price 주문 가격 (type이 "limit", "stop", "stop_limit"인 경우 필수)
 * @param quantity 주문 수량 (양수)
 * @param market_order_slippage_price 시장가 주문의 슬리피지 가격 (선택 사항)
 * @param market_order_slippage_percent 시장가 주문의 슬리피지 퍼센트 (선택 사항)
 * @param market_order_type 시장가 주문의 유형 ("IOC" 또는 "FOK", 선택 사항)
 * @returns `{ message: string, success: boolean, order?: { input } }` || `{ message: string, data: { reason: string } }` - 주문 처리 결과
 */
export const createOrder = rpcBuilder
    .use(authOnlyORPCMiddleware)
    .use(tradableOrderMiddleware)
    .input(CreateOrderSchema)
    .handler(async ({input, context, errors}) => {
        const openOrder = {
            timestamp: Date.now(),
            user_id: context.user!.id,
            order_id: crypto.randomUUID(),
            status: OrderStatus.OPEN as const,
            ...input
        };

        let processedResult;
        await preprocess(openOrder, (err, result) => {
            if (err) throw errors.INTERNAL_SERVER_ERROR({
                message: "Order processing failed",
                data: {
                    reason: err.message
                }
            });
            processedResult = result;
        });
        return processedResult;
    });

/**
 * 사용자가 요청한 주문을 수정합니다.
 * 사용하는 context: context.user.id
 * @param order_id 수정할 주문의 ID
 * @param symbol 심볼 (예: "NVDA")
 * @param type 주문의 유형 ("market", "limit", "stop", "stop_limit", 선택 사항)
 * @param price 주문 가격 (type이 "limit", "stop", "stop_limit"인 경우 필수, 선택 사항)
 * @param quantity 주문 수량 (양수, 선택 사항)
 * @param market_order_slippage_price 시장가 주문의 슬리피지 가격 (선택 사항)
 * @param market_order_slippage_percent 시장가 주문의 슬리피지 퍼센트 (선택 사항)
 * @param market_order_type 시장가 주문의 유형 ("IOC" 또는 "FOK", 선택 사항)
 * @returns `{ message: string, success: boolean, order?: { input } }` || `{ message: string, data: { reason: string } }` - 주문 처리 결과
 */
export const modifyOrder = rpcBuilder
    .use(authOnlyORPCMiddleware)
    .use(tradableOrderMiddleware)
    .input(ModifyOrderSchema)
    .handler(async ({input, context, errors}) => {
        const modifiedOrder = {
            timestamp: Date.now(),
            user_id: context.user!.id,
            status: OrderStatus.MODIFIED as const,
            ...input
        }

        let processedResult;
        await preprocess(modifiedOrder, (err, result) => {
            if (err) throw errors.INTERNAL_SERVER_ERROR({
                message: "Order processing failed",
                data: {
                    reason: err.message
                }
            });
            processedResult = result;
        });
        return processedResult;
    });

/**
 * 사용자가 요청한 주문을 취소합니다.
 * 사용하는 context: context.user.id
 * @param order_id 취소할 주문의 ID
 * @param symbol 심볼 (예: "NVDA")
 * @returns `{ message: string, success: boolean, order?: { input } }` || `{ message: string, data: { reason: string } }` - 주문 처리 결과
 */
export const cancelOrder = rpcBuilder
    .use(authOnlyORPCMiddleware)
    .use(tradableOrderMiddleware)
    .input(CancelOrderSchema)
    .handler(async ({input, context, errors}) => {
        const cancelledOrder = {
            timestamp: Date.now(),
            user_id: context.user!.id,
            status: OrderStatus.CANCELLED as const,
            ...input
        }

        let processedResult;
        await preprocess(cancelledOrder, (err, result) => {
            if (err) throw errors.INTERNAL_SERVER_ERROR({
                message: "Order processing failed",
                data: {
                    reason: err.message
                }
            });
            processedResult = result;
        });
        return processedResult;
    });