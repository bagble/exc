import { z } from "zod";
import { getServerORPC } from "$lib/server/rpc/orpc.server";
import {
    addOrder, executeOrder, getMatchablePriceLevels,
    getOrder,
    removeOrder,
    setQtyOrder
} from "$lib/server/redis/presets/depth";
import { logger } from "../../utils/logger";
import { addOrderNotify } from "$lib/server/redis/presets/notify";
import { type OrderAction, OrderQueue } from "$lib/server/OrderQueue";

const symbolQueues = new OrderQueue();

setInterval(() => {
    const queue = symbolQueues.getSymbolStatus('EXC');
    console.log(`[MONITOR] Symbol: EXC -> Queue: pending=${queue.pending}, executing=${queue.executing}`);
}, 1000);

export enum OrderStatus {
    OPEN = "open",
    MODIFIED = "modified",
    CANCELLED = "cancelled",
    FILLED = "filled",
    PARTIALLY_FILLED = "partially_filled"
}

export const InputSchema = z.object({
    timestamp: z.number().int().nonnegative(),
    user_id: z.number().int().nonnegative(),
    order_id: z.string().min(1),
    symbol: z.string().min(1),
    status: z.enum(["open", "modified", "cancelled", "filled", "partially_filled"]),
    side: z.enum(["buy", "sell"]),
    type: z.enum(["market", "limit", "stop", "stop_limit"]),
    price: z.number().nonnegative(),
    quantity: z.number().positive(),
    market_order_slippage_price: z.number().nonnegative().optional(),
    market_order_slippage_percent: z.number().nonnegative().optional(),
    market_order_type: z.enum(["IOC", "FOK"]).optional(),
}).partial();

// TODO: portfolio 시스템과 연동하여 잔고 및 주문 가능 수량 검증 추가
/**
 * 주문 전처리 및 검증
 * @param input - 주문 데이터
 * @param callback - 콜백 함수
 */
export async function preprocess(input: z.infer<typeof InputSchema>, callback: (err: any, result?: any) => void) {
    if (input.timestamp === undefined || input.user_id === undefined || input.symbol === undefined) { // 필수 필드 검증
        return callback(new Error("Missing required fields: timestamp, user_id, or symbol"));
    }

    const symbol = await getServerORPC().symbols.get({symbol: input.symbol});
    if (!symbol || symbol.symbol !== input.symbol) { // 심볼 검증
        return callback(new Error(JSON.stringify({
            message: "Symbol not found",
            symbol: input.symbol
        })));
    }

    if (symbol.status.status === "init" || symbol.status.status === "suspended" || symbol.status.status === "delisted") { // 심볼 상태 검증
        return callback(new Error(JSON.stringify({
            message: `Symbol is not tradable. Current status: ${symbol.status.status}`,
            reason: symbol.status.reason,
            symbol: input.symbol,
            current_status: symbol.status.status
        })));
    }


    // 입력 검증 | OrderID, OrderType, Price, Quantity
    if (input.order_id === undefined || input.order_id === "") { // 주문 아이디 필수
        return callback(new Error(JSON.stringify({
            message: "Invalid or missing order ID",
            order_id: input.order_id
        })));
    }

    if (input.status === OrderStatus.OPEN &&
        (input.type === undefined || (input.type !== "market" && input.type !== "limit" && input.type !== "stop" && input.type !== "stop_limit"))) { // 신규 주문시 타입 필수
        return callback(new Error(JSON.stringify({
            message: "Invalid or missing order type",
            type: input.type
        })));
    }

    if (input.price && (input.price < 0 || input.price % symbol.tick_size !== 0) && (input.type === "limit" || input.type === "stop_limit" || input.type === "stop") && !(input.status === OrderStatus.CANCELLED)) { // 가격은 음수일 수 없고, 틱사이즈의 배수여야함 (취소는 예외)
        return callback(new Error(JSON.stringify({
            message: "Invalid price",
            price: input.price
        })));
    }

    if ((input.quantity === undefined || input.quantity <= 0 || input.quantity < symbol.minimum_order_quantity) && !(input.status === OrderStatus.CANCELLED)) { // 수량은 양수여야함 (취소는 예외)
        return callback(new Error(JSON.stringify({
            message: "Invalid or missing quantity",
            minimum_order_quantity: symbol.minimum_order_quantity
        })));
    }

    let existingOrder;
    if (input.status !== OrderStatus.OPEN) { // Modified, Cancelled에 대한 추가 검증 (주문은 무조건 limit, stop, stop_limit만 남았을 것)
        existingOrder = await getOrder(input.symbol, input.order_id);
        if (!existingOrder) {
            return callback(new Error(JSON.stringify({
                message: "Order not found",
                order_id: input.order_id
            })));
        }

        if (input.user_id !== existingOrder.user_id) { // 유저 아이디 검증
            return callback(new Error(JSON.stringify({
                message: "Order not found",
                order_id: input.order_id
            }))); // 보안상 기존 주문이 없다고 응답
        }

        if (input.status === OrderStatus.MODIFIED) { // 주문 수정시에 추가 검증
            if (input.type === undefined) { // 타입이 없으면 기존 주문 타입으로 설정
                input.type = existingOrder.type;
            }

            if (input.price === undefined) { // 가격이 없으면 기존 주문 가격으로 설정
                input.price = existingOrder.price;
            }

            if (input.price === existingOrder.price && input.quantity === existingOrder.quantity) { // 주문이 바뀐게 없으면 반환
                return callback(new Error(JSON.stringify({
                    message: "No changes detected in the order",
                    order_id: input.order_id
                })));
            }
        }
    }

    if (input.type === "market") { // 시장가 주문시 추가 검증
        input.price = 0; // 가격은 0으로 설정
    }

    // Inactive 상태는 콜 옥션(Call Auction)으로 처리할 예정 [시장가 주문은 불가] -> TODO: 추후 구현 예정 (Portfolio시스템 구현 후)
    if (symbol.status.status === "inactive") { // 심볼이 비활성화 상태인 경우 (콜 옥션)
        if (input.type !== "limit") {
            return callback(new Error(JSON.stringify({
                message: "Only limit orders are allowed in call auction.",
                current_status: symbol.status.status
            })));
        }

        return callback(new Error(JSON.stringify({
            message: "Call auction processing is not implemented yet.",
            current_status: symbol.status.status
        })));
    }

    callback(null, {
        message: "Order processed successfully",
        success: true,
        order: input
    });

    setImmediate(async () => {
        if (input.type !== undefined && input.type !== "limit" && input.type !== "market") { // 현재는 limit, market 주문만 처리
            logger.warn(`Unsupported order type for: ${JSON.stringify(input)}`);
            return;
        }

        switch (input.status) { // 상태에 따른 추가 처리
            case OrderStatus.MODIFIED:
                input.side = existingOrder!.side === "bids" ? "buy" : "sell"; // 기존 주문의 매수/매도 방향 유지 (변경 불가)

                async function handleOrderModification(input: any, existingOrder: any) {
                    if (input.price === existingOrder!.price && input.quantity! < existingOrder!.quantity) {
                        await setQtyOrder(input, existingOrder!);
                        return true; // 처리 완료
                    } else {
                        await removeOrder(input, existingOrder!);
                        return false; // 새로운 주문 처리 필요
                    }
                }

                if (symbolQueues.isInQueue(input.symbol!, input.order_id!, 'open')) {
                    symbolQueues.onOrderFinish(input.symbol!, input.order_id!, 'open', async () => {
                        const done = await handleOrderModification(input, existingOrder!);
                        if (done) return;
                    });
                } else {
                    const done = await handleOrderModification(input, existingOrder!);
                    if (done) return;
                }
                break;
            case OrderStatus.CANCELLED:
                // logger.info(`Order cancellation already in progress: ${JSON.stringify(input)}`);
                if (symbolQueues.isInQueue(input.symbol!, input.order_id!, 'open')) { // 이미 대기열에 있는 주문인 경우 대기열에서 제거
                    symbolQueues.cancelQueuedOrder(input.symbol!, input.order_id!, 'open');
                    return;
                }
                return await removeOrder(input, existingOrder!); // 기존 주문 제거 후 종료
        }

        const priority = input.type === 'market' ? 1 : 0;

        await symbolQueues.submitOrder(input.symbol!, input.order_id!, input.status! as OrderAction, {input, symbol, priority});

        // logger.info(`Processed order: ${JSON.stringify(input)}`);
    });
}

/**
 * 주문 처리 및 체결
 * @param input - 주문 데이터
 * @param symbolData - 심볼 데이터
 */
export async function processOrder(input: z.infer<typeof InputSchema>, symbolData: any) {
    const matchable = await getMatchablePriceLevels(input.symbol!, input.side === "buy" ? "asks" : "bids", input.quantity!, input.price!);
    if (!matchable || matchable.levels === 0 || !matchable.prices) {
        // logger.info(`No matchable price levels found. Adding order to the book. Order ID: ${input.order_id}, Side: ${input.side}, Quantity: ${input.quantity}, Price: ${input.price}`);
        return returnAddOrder(input);
    }

    if (input.type === "market") { // 시장가 주문 또는 스탑 주문인 경우 추가 처리
        if (input.market_order_type && input.market_order_type === "FOK" && !matchable.fulfilled) { // Fill Or Kill 조건인데 체결 불가능한 경우
            // logger.info(`FOK condition not met. Order will be cancelled. Order ID: ${input.order_id}, Side: ${input.side}, Quantity: ${input.quantity}, Price: ${input.price}`);
            return; // 아무것도 하지 않고 종료
        }

        if (input.market_order_slippage_price !== undefined && input.market_order_slippage_price > 0 &&
            input.market_order_slippage_percent !== undefined && input.market_order_slippage_percent > 0) { // 슬리피지 조건이 있는 경우
            const slippagePrice = input.side === "buy" ?
                input.market_order_slippage_price * (1 + input.market_order_slippage_percent! / 100) :
                input.market_order_slippage_price * (1 - input.market_order_slippage_percent! / 100); // 슬리피지 퍼센트 적용 가격 계산 (매수는 높아지고, 매도는 낮아짐)

            if (input.side === "buy" && matchable.prices[matchable.prices.length - 1] > slippagePrice) { // 매수 주문인데 가장 유리한 가격이 슬리피지 가격보다 높은 경우
                // logger.info(`Slippage condition not met for buy order. Order will be cancelled. Order ID: ${input.order_id}, Side: ${input.side}, Quantity: ${input.quantity}, Price: ${input.price}`);
                return; // 아무것도 하지 않고 종료
            }

            if (input.side === "sell" && matchable.prices[matchable.prices.length - 1] < slippagePrice) { // 매도 주문인데 가장 유리한 가격이 슬리피지 가격보다 낮은 경우
                // logger.info(`Slippage condition not met for sell order. Order will be cancelled. Order ID: ${input.order_id}, Side: ${input.side}, Quantity: ${input.quantity}, Price: ${input.price}`);
                return; // 아무것도 하지 않고 종료
            }
        }
    }

    // 체결

    // logger.info(`Order can be matched. Order ID: ${input.order_id}, Side: ${input.side}, Quantity: ${input.quantity}, Price: ${input.price}`);

    if (input.type === "market" ||  // 시장가 주문 또는 스탑 주문인 경우
        (input.type === "limit" && input.side === "buy" ? input.price! >= matchable.prices[0] : input.price! <= matchable.prices[0])) {  // 지정가 주문인데 체결 가능한 가격이 있는 경우
        // logger.info(`Starting order matching for order_id: ${input.order_id}, side: ${input.side}, quantity: ${input.quantity}, price: ${input.price}`);

        addOrderNotify(input.user_id!, {
            timestamp: input.timestamp!,
            message_id: crypto.randomUUID(),
            user_id: input.user_id!,
            order_id: input.order_id!,
            symbol: input.symbol!,
            side: input.side!,
            type: input.type!,
            price: input.price!,
            quantity: input.quantity!,
            status: input.status as OrderStatus
        });

        await executeOrder(input, symbolData, matchable.prices);
    }

    if (!matchable.fulfilled && input.type === "limit") { // 지정가 주문 또는 스탑 지정가 주문인데 잔여 수량이 남아있는 경우
        // logger.info(`Order not fully matched. Adding remaining quantity to the book. Order ID: ${input.order_id}, Side: ${input.side}, Remaining Quantity: ${input.quantity}, Price: ${input.price}`);
        return returnAddOrder(input);
    }

    if (input.type === "market" && input.quantity! > 0) { // 시장가 주문인데 잔여 수량이 남아있는 경우 (체결되지 않은 잔여 수량은 취소 처리)
        addOrderNotify(input.user_id!, {
            timestamp: Date.now(),
            message_id: crypto.randomUUID(),
            user_id: input.user_id!,
            order_id: input.order_id!,
            symbol: input.symbol!,
            side: input.side!,
            type: input.type!,
            price: 0,
            quantity: input.quantity!,
            status: OrderStatus.CANCELLED
        });
    }
}

/**
 * 호가창에 주문 추가 및 알림
 * @param input - 주문 데이터
 */
async function returnAddOrder(input: z.infer<typeof InputSchema>) {
    if (input.type === "market") { // 시장가 주문이 체결되지 않고 남아있는 경우 바로 취소 처리
        addOrderNotify(input.user_id!, {
            timestamp: Date.now(),
            message_id: crypto.randomUUID(),
            user_id: input.user_id!,
            order_id: input.order_id!,
            symbol: input.symbol!,
            side: input.side!,
            type: input.type!,
            price: 0,
            quantity: input.quantity!,
            status: OrderStatus.CANCELLED
        });
        return;
    }

    addOrderNotify(input.user_id!, {
        timestamp: input.timestamp!,
        message_id: crypto.randomUUID(),
        user_id: input.user_id!,
        order_id: input.order_id!,
        symbol: input.symbol!,
        side: input.side!,
        type: input.type!,
        price: input.price!,
        quantity: input.quantity!,
        status: input.status as OrderStatus
    });

    return await addOrder(input, input.side === "buy" ? "bids" : "asks"); // 호가창에 추가 후 종료
}