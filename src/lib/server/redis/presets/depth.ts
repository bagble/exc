import { redis } from "$lib/server/redis/db";
import { InputSchema, OrderStatus } from "$lib/server/ProcessOrder";
import { z } from "zod";
import { logger } from "../../../../utils/logger";
import { session } from "../../loader/EXC";
import { addLedger } from "$lib/server/redis/presets/ledger";
import { addOrderNotify } from "$lib/server/redis/presets/notify";
import { broadcastToDataClients, getDataClients, hasDataClient } from "$lib/server/sse";
import { saveTickBatch } from "$lib/server/redis/presets/chart";

type depthType = {
    updateId?: number
    depth: {
        bids: [number, number][], // [price, quantity][]
        asks: [number, number][]
    }
};

const previousCloseCache = new Map<string, { price: number, timestamp: number }>();
const CACHE_TTL_MS = 60000;

/* Depth SSE Sender */

let stopped = false;

export function stopDepthUpdate() {
    stopped = true;
}

let depthUpdates = new Map<string, Map<string, Map<number, number>>>();
let isDepthFlushLoopRunning = false;

async function depthFlushLoop(delayMs = 100) {
    if (stopped) return;

    if (isDepthFlushLoopRunning) {
        setTimeout(() => {
            void depthFlushLoop(delayMs);
        }, delayMs);
        return;
    }

    isDepthFlushLoopRunning = true;

    try {
        const batch = new Map<string, Map<string, Map<number, number>>>();

        for (const [symbol, sideMap] of depthUpdates.entries()) {
            const newSideMap = new Map<string, Map<number, number>>();

            for (const [side, priceMap] of sideMap.entries()) {
                newSideMap.set(side, new Map(priceMap));  // priceMap 복사
            }

            batch.set(symbol, newSideMap);
        }

        depthUpdates.clear();

        for (const [symbol, sideUpdates] of batch.entries()) {
            if (sideUpdates.size === 0) continue;

            const updateId = await redis.incr(`symbol:${symbol}:depth:updateId`);

            const bids: [number, number][] = [];
            const asks: [number, number][] = [];

            const bidMap = sideUpdates.get('bids');
            if (bidMap) {
                for (const [price, qty] of bidMap.entries()) bids.push([price, qty ?? 0]);
            }

            const askMap = sideUpdates.get('asks');
            if (askMap) {
                for (const [price, qty] of askMap.entries()) asks.push([price, qty ?? 0]);
            }

            if (bids.length > 0 || asks.length > 0) {
                const message = {
                    type: 'update',
                    updateId,
                    depth: {bids, asks},
                };

                await broadcastToDataClients(
                    symbol,
                    'depth',
                    JSON.stringify(message),
                    {partial_book: false, depth: true},
                );
            }
        }
    } catch (e) {
        logger.error(`Failed to broadcast depth updates: ${e}`);
    } finally {
        isDepthFlushLoopRunning = false;
        if (!stopped) {
            setTimeout(() => {
                void depthFlushLoop(delayMs);
            }, delayMs);
        }
    }
}

void depthFlushLoop(100); // Depth Delta 업데이트 병합 및 전송 (100ms 간격)

let depthCache: Map<string, number> = new Map<string, number>();
let isPartialBookFlushLoopRunning = false;

async function partialBookFlushLoop(delayMs = 250) {
    if (stopped) return;

    if (isPartialBookFlushLoopRunning) {
        setTimeout(() => {
            void partialBookFlushLoop(delayMs);
        }, delayMs);
        return;
    }

    isPartialBookFlushLoopRunning = true;

    try {
        for (let symbol in getDataClients()) {
            if (hasDataClient(symbol, {partial_book: true, depth: true})) {
                const depth = await getDepth(symbol, 15);
                if (depth.updateId === depthCache.get(symbol)) continue; // 변경 사항이 없으면 건너뜀

                depthCache.set(symbol, depth.updateId!);
                const message = {
                    type: "partial",
                    ...depth
                };

                await broadcastToDataClients(symbol, 'depth', JSON.stringify(message), {
                    partial_book: true,
                    depth: true
                });
            }
        }
    } catch (e) {
        logger.error(`Failed to broadcast partial book updates: ${e}`);
    } finally {
        isPartialBookFlushLoopRunning = false;
        if (!stopped) {
            setTimeout(() => {
                void partialBookFlushLoop(delayMs);
            }, delayMs);
        }
    }
}

void partialBookFlushLoop(250); // Partial Book (250ms 간격) [25호가만 전송]

function addDepthUpdate(symbol: string, side: 'bids' | 'asks', depth: Array<{ price: number, quantity: number }>) {
    if (!depthUpdates.has(symbol)) {
        depthUpdates.set(symbol, new Map<string, Map<number, number>>());
    }
    const sideMap = depthUpdates.get(symbol)!;

    if (!sideMap.has(side)) {
        sideMap.set(side, new Map<number, number>());
    }
    const priceMap = sideMap.get(side)!;

    for (const level of depth) {
        priceMap.set(level.price, level.quantity);
    }
}

/* Depth Getter */

/**
 * 호가 정보 조회
 * @param symbol 심볼
 * @param top 상위 N개 호가 (0 이하일 경우 빈 데이터 반환)
 */
export async function getDepth(symbol: string, top: number): Promise<depthType> {
    if (top <= 0) {
        return {updateId: -1, depth: {bids: [], asks: []}} as depthType;
    }

    if (top <= 100) {
        return getDepthWithZRange(symbol, top);
    }

    return getDepthWithHGetAll(symbol, top);
}

async function getDepthWithZRange(symbol: string, top: number) {
    try {
        // language=Lua
        const script = `
            local top = tonumber(ARGV[1])
            local bidsSetKey = KEYS[1] .. 'bids'
            local bidsQtyKey = KEYS[1] .. 'bids:qty'
            local asksSetKey = KEYS[1] .. 'asks'
            local asksQtyKey = KEYS[1] .. 'asks:qty'
            local updateIdKey = KEYS[1] .. 'updateId'

            local function getTopPrices(setKey, qtyKey, isReverse)
                local uniquePrices = {}
                local seenPrices = {}
                local batchSize = math.min(top * 20, 1000)
                local offset = 0
                local maxBatch = 15
                local batch = 0

                while #uniquePrices < top and batch < maxBatch do
                    local results
                    if isReverse then
                        results = redis.call('ZREVRANGE', setKey, offset, offset + batchSize - 1, 'WITHSCORES')
                    else
                        results = redis.call('ZRANGE', setKey, offset, offset + batchSize - 1, 'WITHSCORES')
                    end

                    if #results == 0 then
                        break
                    end

                    for i = 1, #results, 2 do
                        local member = results[i]
                        local score = tonumber(results[i + 1])

                        -- member에서 가격 추출: order_id|user_id|quantity|timestamp|type
                        local fields = {}
                        for val in string.gmatch(member, "([^|]+)") do
                            table.insert(fields, val)
                        end

                        if #fields >= 4 then
                            local timestamp = tonumber(fields[4])
                            local normalizedTimestamp = timestamp / 1e13
                            local price = score / normalizedTimestamp

                            price = math.floor(price * 1000000 + 0.5) / 1000000

                            if not seenPrices[price] then
                                seenPrices[price] = true
                                table.insert(uniquePrices, price)
                                if #uniquePrices >= top then
                                    break
                                end
                            end
                        end
                    end

                    offset = offset + batchSize
                    batch = batch + 1
                end

                local result = {}
                for _, price in ipairs(uniquePrices) do
                    local qty = redis.call('HGET', qtyKey, tostring(price))
                    if qty and tonumber(qty) > 0 then
                        table.insert(result, { price, tonumber(qty) })
                    end
                end

                return result
            end

            local bids = getTopPrices(bidsSetKey, bidsQtyKey, true)
            local asks = getTopPrices(asksSetKey, asksQtyKey, false)
            local updateId = tonumber(redis.call('GET', updateIdKey)) or 0

            return { cjson.encode({ bids = bids, asks = asks }), updateId }
        `;

        const result = await redis.eval(script, 1, `symbol:${symbol}:depth:`, top.toString()) as [string, number];
        const parsed = JSON.parse(result[0]);
        return {
            updateId: result[1],
            depth: {
                bids: Array.isArray(parsed.bids) ? parsed.bids : [],
                asks: Array.isArray(parsed.asks) ? parsed.asks : []
            }
        } as depthType;
    } catch (e) {
        logger.error(`Failed to get depth with ZRANGE: ${e}`);
        return {updateId: -1, depth: {bids: [], asks: []}} as depthType;
    }
}

async function getDepthWithHGetAll(symbol: string, top: number) {
    try {
        // language=Lua
        const script = `
            local top = tonumber(ARGV[1])
            local bidsQtyKey = KEYS[1] .. 'bids:qty'
            local asksQtyKey = KEYS[1] .. 'asks:qty'
            local updateIdKey = KEYS[1] .. 'updateId'

            local function parseAndSort(qtyKey, descending)
                local pairs = redis.call('HGETALL', qtyKey)
                local items = {}

                for i = 1, #pairs, 2 do
                    local price = tonumber(pairs[i])
                    local qty = tonumber(pairs[i + 1])
                    if qty > 0 then
                        table.insert(items, { price, qty })
                    end
                end

                table.sort(items, function(a, b)
                    if descending then
                        return a[1] > b[1]
                    else
                        return a[1] < b[1]
                    end
                end)

                -- 상위 N개만 또는 전체
                local limit = (top > 0 and top < #items) and top or #items
                local result = {}
                for i = 1, limit do
                    table.insert(result, items[i])
                end
                return result
            end

            local bids = parseAndSort(bidsQtyKey, true)   -- 내림차순
            local asks = parseAndSort(asksQtyKey, false)  -- 오름차순
            local updateId = tonumber(redis.call('GET', updateIdKey)) or 0

            return { cjson.encode({ bids = bids, asks = asks }), updateId }
        `;

        const result = await redis.eval(script, 1, `symbol:${symbol}:depth:`, top.toString()) as [string, number];
        const parsed = JSON.parse(result[0]);
        return {
            updateId: result[1],
            depth: {
                bids: Array.isArray(parsed.bids) ? parsed.bids : [],
                asks: Array.isArray(parsed.asks) ? parsed.asks : []
            }
        } as depthType;
    } catch (e) {
        logger.error(`Failed to get depth with HGETALL: ${e}`);
        return {updateId: -1, depth: {bids: [], asks: []}} as depthType;
    }
}

/**
 * 목표 수량을 충족할 수 있는 가격대 조회
 * @param symbol 심볼
 * @param side "bids" | "asks"
 * @param targetQty 목표 수량
 * @param limitPrice 제한 가격 (0 이거나 작성하지 않으면 무제한)
 */
export async function getMatchablePriceLevels(symbol: string, side: "bids" | "asks", targetQty: number, limitPrice?: number) {
    if (targetQty <= 0) {
        return null;
    }

    try {
        // language=Lua
        const script = `
            local targetQty = tonumber(ARGV[1])
            local limitPrice = ARGV[2] ~= '' and tonumber(ARGV[2]) or nil

            local priceLevels = redis.call('HGETALL', KEYS[1])
            if #priceLevels == 0 then
                return {0, 0, {}}  -- levels, fulfilled, prices
            end

            local prices = {}
            local quantities = {}
            local isBids = KEYS[1]:find('bids') ~= nil

            for i = 1, #priceLevels, 2 do
                local price = tonumber(priceLevels[i])
                local qty = tonumber(priceLevels[i + 1])
                if qty > 0 then
                    table.insert(prices, price)
                    quantities[price] = qty
                end
            end

            if isBids then
                table.sort(prices, function(a, b) return a > b end)
            else
                table.sort(prices, function(a, b) return a < b end)
            end

            local accumulatedQty = 0
            local levels = 0
            local matchablePrices = {}

            for _, price in ipairs(prices) do
                if limitPrice and limitPrice > 0 then
                    if (isBids and price < limitPrice) or (not isBids and price > limitPrice) then
                        break
                    end
                end

                local qty = quantities[price]
                accumulatedQty = accumulatedQty + qty
                levels = levels + 1
                table.insert(matchablePrices, price)

                if accumulatedQty >= targetQty then
                    return {levels, 1, matchablePrices}  -- fulfilled = 1
                end
            end

            return {levels, 0, matchablePrices}  -- fulfilled = 0
        `;

        const result = await redis.eval(
            script,
            1,
            `symbol:${symbol}:depth:${side}:qty`,
            targetQty.toString(),
            limitPrice ? limitPrice.toString() : ''
        ) as [number, number, number[]];

        const [levels, fulfilled, prices] = result;

        return {
            levels,
            fulfilled: fulfilled === 1,
            prices: prices.length > 0 ? prices : null
        };
    } catch (e) {
        logger.error(`Failed to get matchable price levels: ${e}`);
        return null;
    }
}

/**
 * 유저별 주문 조회
 * @param user_id 유저 ID
 */
export async function getUserOrders(user_id: string) { // 유저별 주문 조회 (raw 데이터로 반환합니다 리턴값: {order_id:symbol}[])
    let result;
    try {
        result = await redis.hgetall(`user:${user_id}:orders`);
    } catch (e) {
        logger.error(`Failed to get user orders: ${e}`);
        result = null;
    }

    return result;
}

/**
 * 주문 ID로 주문 조회
 * @param symbol 심볼
 * @param order_id 주문 ID
 */
export async function getOrder(symbol: string, order_id: string) { // order_id로 주문 조회 { timestamp, user_id, symbol, side, type, price, quantity }
    let result;
    try {
        result = await redis.hget(`symbol:${symbol}:orders`, order_id);
    } catch (e) {
        logger.error(`Failed to get order: ${e}`);
        result = null;
    }

    return JSON.parse(result!);
}

/* Depth Updater */

/**
 * 주문 실행
 * @param input 주문 입력 데이터
 * @param symbolData 심볼 데이터
 * @param prices 가격 목록
 */
export async function executeOrder(input: z.infer<typeof InputSchema>, symbolData: any, prices: number[]) {
    try {
        // language=Lua
        const script = `
            local totalQtyKey = KEYS[1] -- price: total_quantity
            local depthSortedSetKey = KEYS[2] -- score(price * (timestamp / 1e13)): order_id|user_id|quantity|timestamp|type
            local ordersHashKey = KEYS[3] -- order_id: {timestamp user_id symbol side type price quantity}
            local price = tonumber(ARGV[1]) -- 가격 목록 (쉼표로 구분된 문자열)
            local targetQty = tonumber(ARGV[2]) -- 소모할 총 수량
            local time = redis.call('TIME') -- 현재 시간

            local currentQty = tonumber(redis.call('HGET', totalQtyKey, price)) or 0
            if currentQty <= 0 then
                return { 0, targetQty, '', '', 0, -1 }
            end

            -- return 목록
            local execQty = math.min(currentQty, targetQty)
            local remainingQty = targetQty - execQty
            local executedOrders = ""
            local partiallyFilledOrderId = ""
            local newTotalQty = currentQty - execQty
            local executedAt = time[1] * 1000 + math.floor(time[2] / 1000)

            if newTotalQty <= 0 then
                redis.call('HDEL', totalQtyKey, price)
            else
                redis.call('HSET', totalQtyKey, price, tostring(newTotalQty))
            end

            local qtyToExecute = execQty

            local minScore = (price - 0.0001) * (1 / 1e13)
            local maxScore = (price + 0.0001) * (9999999999999 / 1e13)
            local members = redis.call('ZRANGEBYSCORE', depthSortedSetKey, minScore, maxScore, 'WITHSCORES')

            for i = 1, #members, 2 do
                if qtyToExecute <= 0 then
                    break
                end

                local member = members[i]
                local score = tonumber(members[i + 1])
                local fields = {}
                for val in string.gmatch(member, "([^|]+)") do
                    table.insert(fields, val)
                end
                local order_id = fields[1]
                local user_id = fields[2]
                local orderQty = tonumber(fields[3])
                local orderTimestamp = tonumber(fields[4])
                local orderType = fields[5]
                local normalizedTimestamp = orderTimestamp / 1e13
                local orderPrice = score / normalizedTimestamp

                if math.abs(orderPrice - price) < 0.0001 then
                    local execFromOrder = math.min(orderQty, qtyToExecute)
                    qtyToExecute = qtyToExecute - execFromOrder

                    local execOrder = table.concat({
                        order_id,
                        user_id,
                        totalQtyKey:find('bids') and 'buy' or 'sell',
                        tostring(price),
                        tostring(execFromOrder),
                        tostring(orderType)
                    }, '|') -- 체결된 주문 정보 생성
                    executedOrders = executedOrders .. ',' .. execOrder -- 체결된 주문 목록 업데이트

                    if execFromOrder >= orderQty then
                        redis.call('ZREM', depthSortedSetKey, member)
                        redis.call('HDEL', ordersHashKey, order_id)
                        redis.call('HDEL', 'user:' .. user_id .. ':orders', order_id)
                    else
                        partiallyFilledOrderId = order_id

                        local newQty = orderQty - execFromOrder
                        local newMember = table.concat({
                            order_id,
                            user_id,
                            tostring(newQty),
                            tostring(orderTimestamp),
                            orderType
                        }, '|') -- 새로운 멤버 문자열 생성
                        redis.call('ZREM', depthSortedSetKey, member)
                        redis.call('ZADD', depthSortedSetKey, score, newMember)

                        local orderInfoStr = redis.call('HGET', ordersHashKey, order_id)
                        if orderInfoStr then
                            local orderInfo = cjson.decode(orderInfoStr)
                            orderInfo.quantity = newQty
                            redis.call('HSET', ordersHashKey, order_id, cjson.encode(orderInfo))
                        end
                    end
                end
            end

            return {
                execQty,
                remainingQty,
                executedOrders:sub(2),
                partiallyFilledOrderId,
                newTotalQty,
                executedAt
            }
        `;

        const side = input.side === "buy" ? "asks" : "bids";
        let remainingQty = input.quantity!;
        let executedOrders = "";
        let partiallyFilledOrderId = "";
        let executedAt = 0;

        let ticks: { price: number, volume: number, timestamp: number }[] = [];
        let depth: { price: number, quantity: number }[] = [];

        for (const price of prices) {
            if (remainingQty <= 0) break; // 소모할 수량이 없으면 종료
            const result = await redis.eval(
                script,
                3,
                `symbol:${input.symbol}:depth:${side}:qty`,
                `symbol:${input.symbol}:depth:${side}`,
                `symbol:${input.symbol}:orders`,
                price.toString(),
                remainingQty.toString()
            ) as [number, number, string, string | null, number, number];
            const [newExecQty, newRemainingQty, newExecutedOrders, newPartiallyFilledOrderId, newTotalQty, lastExecutedAt] = result;

            depth.push({price, quantity: newTotalQty ?? 0});
            if (newExecQty > 0) ticks.push({price, volume: newExecQty, timestamp: lastExecutedAt});
            remainingQty = newRemainingQty;
            executedOrders = executedOrders ? executedOrders + ',' + newExecutedOrders : newExecutedOrders;
            partiallyFilledOrderId = newPartiallyFilledOrderId ? newPartiallyFilledOrderId : partiallyFilledOrderId;
            executedAt = lastExecutedAt;
        }

        addDepthUpdate(input.symbol!, side, depth); // 호가 변화 알림 큐에 추가
        saveTickBatch(input.symbol!, ticks).catch((e => {
            logger.error(`Failed to save tick batch: ${e}`);
        }));

        input.quantity = remainingQty;
        return await executeOrderPostProcessing(input, symbolData, [executedOrders, partiallyFilledOrderId, executedAt]);

    } catch (e) {
        logger.error(`Failed to execute order: ${e}`);
        return {result: false};
    }
}

async function executeOrderPostProcessing(input: z.infer<typeof InputSchema>, symbolData: any, results: [string, string | null, number]) {
    const [executedOrders, partiallyFilledOrderId, executedAt] = results;
    const execOrderStrList = executedOrders.split(",");

    if (executedOrders !== "") {
        const cache = previousCloseCache.get(input.symbol!)

        const pipeline = redis.pipeline();
        pipeline.incrby(`symbol:${input.symbol}:ledger:updateId`, execOrderStrList.length);
        pipeline.get(`symbol:${input.symbol}:ledger:cumulativeVolume`);
        if (!cache || (executedAt - cache.timestamp) > CACHE_TTL_MS) pipeline.zrevrange(`symbol:${input.symbol}:1D:charts`, 0, 1, 'WITHSCORES');
        const results = await pipeline.exec();

        let sequence = parseInt(results?.[0]?.[1] as string) - execOrderStrList.length || 0;
        let cumulativeVolume = parseFloat(results?.[1]?.[1] as string) || 0;
        let previousClose: number;
        if (!cache || (executedAt - cache.timestamp) > CACHE_TTL_MS) {
            previousClose = Array.isArray(results?.[2]?.[1]) && typeof results[2][1][2] === "string"
                ? parseFloat(results[2][1][2].split("|")[3]) : parseFloat(symbolData.ipo_price);
            previousCloseCache.set(input.symbol!, {price: previousClose, timestamp: executedAt});
        } else {
            previousClose = cache.price;
        }
        const condition = session.session.substring(0, 2);

        const ledgers: any[] = [];
        const notifyMap: Map<number, any[]> = new Map<number, any[]>();

        const BATCH_SIZE = 500;
        const pipelines = [];
        let currentPipeline = redis.pipeline();
        let count = 0;

        for (const execOrderStr of execOrderStrList) {
            const [order_id, user_idStr, side, priceStr, qtyStr, type] = execOrderStr.split("|");
            const user_id = parseInt(user_idStr);
            const price = parseFloat(priceStr);
            const quantity = parseInt(qtyStr);

            sequence++;
            cumulativeVolume += quantity;

            const isPartiallyFilled = partiallyFilledOrderId === order_id;

            const ledgerData = {
                timestamp: executedAt,
                symbol: input.symbol!,
                price: price,
                volume: quantity,
                side: input.side!,
                buyer_order_id: input.side === "buy" ? input.order_id! : order_id,
                seller_order_id: input.side === "sell" ? input.order_id! : order_id,
                execution_id: crypto.randomUUID(),
                conditions: condition,
                sequence,
                cumulativeVolume: cumulativeVolume,
                change: Math.round(((price - previousClose) / previousClose) * 100 * 100) / 100
            }

            const orderNotify = {
                timestamp: executedAt,
                message_id: crypto.randomUUID(),
                user_id: input.user_id!,
                order_id: input.order_id!,
                symbol: input.symbol!,
                side: input.side!,
                type: input.type!,
                price: price,
                quantity: quantity,
                status: isPartiallyFilled ? OrderStatus.FILLED : OrderStatus.PARTIALLY_FILLED
            }

            const orderNotifyCounterpart = {
                timestamp: executedAt,
                message_id: crypto.randomUUID(),
                user_id: user_id,
                order_id: order_id,
                symbol: input.symbol!,
                side: side as "buy" | "sell",
                type: type as "limit" | "market" | "stop" | "stop_limit",
                price: price,
                quantity: quantity,
                status: isPartiallyFilled ? OrderStatus.PARTIALLY_FILLED : OrderStatus.FILLED
            }

            addLedger(input.symbol!, ledgerData, currentPipeline);
            addOrderNotify(input.user_id!, orderNotify, currentPipeline);
            addOrderNotify(user_id, orderNotifyCounterpart, currentPipeline);

            ledgers.push(ledgerData);
            if (!notifyMap.has(input.user_id!)) {
                notifyMap.set(input.user_id!, []);
            }
            notifyMap.get(input.user_id!)!.push(orderNotify);
            if (!notifyMap.has(user_id)) {
                notifyMap.set(user_id, []);
            }
            notifyMap.get(user_id)!.push(orderNotifyCounterpart);

            count += 3;

            if (count >= BATCH_SIZE) {
                pipelines.push(currentPipeline);
                currentPipeline = redis.pipeline();
                count = 0;
            }
        }

        currentPipeline.set(`symbol:${input.symbol}:ledger:cumulativeVolume`, cumulativeVolume.toString());
        pipelines.push(currentPipeline);

        await Promise.all(pipelines.map(p => p.exec()));

        if (ledgers.length > 0) {
            broadcastToDataClients(input.symbol!, 'ledger', JSON.stringify({
                type: "update",
                ledger: ledgers
            }), {ledger: true}).catch(e => {
                logger.error(`Failed to broadcast ledger: ${e}`);
            });
        }

        for (const [userId, notifications] of notifyMap) {
            broadcastToDataClients(userId.toString(), 'order', JSON.stringify({
                type: "update",
                notify: notifications
            }), {order: true}).catch(e => {
                logger.error(`Failed to broadcast order: ${e}`);
            });
        }
    }

    return {
        result: true,
    }
}

/**
 * 주문을 호가에 추가
 * @param input 주문 입력 데이터
 * @param side "bids" | "asks"
 */
export async function addOrder(input: z.infer<typeof InputSchema>, side: "bids" | "asks") { // 주문을 호가에 추가
    if (!input.price || !input.timestamp || !input.quantity || !input.user_id || !input.order_id) {
        return false;
    }

    const score = input.price * (input.timestamp / 1e13); // 타임스탬프를 정규화하여 가격 우선, 시간 후순위 정렬
    const member = `${input.order_id}|${input.user_id}|${input.quantity}|${input.timestamp}|${input.type}`;

    try {
        const multi = redis.pipeline();
        multi.hincrby(`symbol:${input.symbol}:depth:${side}:qty`, input.price.toString(), input.quantity); // 가격대별 총 수량 증가
        multi.zadd(`symbol:${input.symbol}:depth:${side}`, score, member); // 호가에 주문 추가
        multi.hset(`symbol:${input.symbol}:orders`, input.order_id, JSON.stringify({ // 전체 주문 목록에 주문 추가
            "timestamp": input.timestamp,
            "user_id": input.user_id,
            "symbol": input.symbol,
            "side": side,
            "type": input.type,
            "price": input.price,
            "quantity": input.quantity
        }));
        multi.hset(`user:${input.user_id}:orders`, input.order_id, input.symbol!); // 유저별 주문 목록에 주문 추가
        multi.hget(`symbol:${input.symbol}:depth:${side}:qty`, input.price.toString()); // 해당 가격대 총 수량 조회
        const results = await multi.exec();
        const newTotalQty = parseInt(results![4][1] as string); // 마지막 결과에서 총 수량 가져오기

        if (results) { // 성공적으로 처리된 경우 SSE 알림 전송
            // 호가 변화 알림 큐에 추가
            addDepthUpdate(input.symbol!, side, [{price: input.price, quantity: newTotalQty}]);
        }

        return true;
    } catch (e) {
        logger.error(`Failed to add order: ${e}`);
        return false;
    }
}

/**
 * 주문을 호가에서 제거
 * @param input 주문 입력 데이터
 * @param existingOrder 기존 주문 데이터
 */
export async function removeOrder(input: z.infer<typeof InputSchema>, existingOrder: any) { // 주문을 호가에서 제거
    if (!input.timestamp || !input.user_id || !input.order_id) {
        return false;
    }

    const member = `${input.order_id}|${input.user_id}|${existingOrder.quantity}|${existingOrder.timestamp}|${existingOrder.type}`;

    try {
        // language=Lua
        const script = `
            local currentQty = redis.call('HGET', KEYS[1], ARGV[1]) -- 현재 가격대별 총 수량 조회
            local newQty = (tonumber(currentQty) or 0) - tonumber(ARGV[2]) -- 가격대별 총 수량 계산
            if newQty == 0 then
                redis.call('HDEL', KEYS[1], ARGV[1]) -- 가격대별 총 수량이 0이 되면 해당 가격대 제거
            else
                redis.call('HINCRBY', KEYS[1], ARGV[1], -tonumber(ARGV[2])) -- 가격대별 총 수량 감소
            end
            redis.call('ZREM', KEYS[2], ARGV[3]) -- 호가에서 주문 제거
            redis.call('HDEL', KEYS[3], ARGV[4]) -- 전체 주문 목록에서 주문 제거
            redis.call('HDEL', KEYS[4], ARGV[4]) -- 유저별 주문 목록에서 주문 제거
            return { 1, newQty }
        `;
        const result = await redis.eval(
            script,
            4,
            `symbol:${input.symbol}:depth:${existingOrder.side}:qty`,
            `symbol:${input.symbol}:depth:${existingOrder.side}`,
            `symbol:${input.symbol}:orders`,
            `user:${input.user_id}:orders`,
            existingOrder.price.toString(),
            existingOrder.quantity.toString(),
            member,
            input.order_id
        ) as [number, number];

        const [status, newTotalQty] = result;

        if (status === 1) { // 성공적으로 처리된 경우 SSE 알림 전송
            // 주문 수정의 경우는 이 함수를 이용하지만 알림은 따로 처리
            switch (input.status) {
                case "cancelled": // 주문 취소 알림
                    addOrderNotify(input.user_id, {
                        timestamp: Date.now(),
                        message_id: crypto.randomUUID(),
                        user_id: input.user_id,
                        order_id: input.order_id,
                        symbol: input.symbol!,
                        side: existingOrder.side,
                        type: existingOrder.type,
                        price: existingOrder.price,
                        quantity: existingOrder.quantity,
                        status: input.status as OrderStatus
                    });
                    break;
            }

            // 호가 변화 알림 큐에 추가
            addDepthUpdate(input.symbol!, existingOrder.side, [{price: existingOrder.price, quantity: newTotalQty}]);
        }
    } catch (e) {
        logger.error(`Failed to remove order: ${e}`);
        return false;
    }
}

/**
 * 주문 수량을 변경
 * @param input 주문 입력 데이터
 * @param existingOrder 기존 주문 데이터
 */
export async function setQtyOrder(input: z.infer<typeof InputSchema>, existingOrder: any) { // 주문 수량을 감소
    if (!input.price || !input.quantity || !input.user_id || !input.order_id) {
        return false;
    }
    if (existingOrder.quantity < input.quantity || existingOrder.price !== input.price) {
        return false; // 수량이 증가하거나 가격이 변경되는 경우 false 반환
    }

    const oldMember = `${input.order_id}|${input.user_id}|${existingOrder.quantity}|${existingOrder.timestamp}|${existingOrder.type}`;
    const newMember = `${input.order_id}|${input.user_id}|${input.quantity}|${existingOrder.timestamp}|${existingOrder.type}`;

    try {
        const multi = redis.multi(); // 원자적 처리를 위해 멀티 사용
        multi.hincrby(`symbol:${input.symbol}:depth:${existingOrder.side}:qty`, existingOrder.price, -existingOrder.quantity + input.quantity); // 가격대별 총 수량 감소
        multi.zrem(`symbol:${input.symbol}:depth:${existingOrder.side}`, oldMember); // 기존 주문 제거
        multi.zadd(`symbol:${input.symbol}:depth:${existingOrder.side}`, existingOrder.price * (existingOrder.timestamp / 1e13), newMember); // 같은 가격, 같은 타임스탬프로 재등록
        multi.hset(`symbol:${input.symbol}:orders`, input.order_id, JSON.stringify({ // 전체 주문 목록에 주문 정보 업데이트
            "timestamp": existingOrder.timestamp,
            "user_id": existingOrder.user_id,
            "symbol": input.symbol,
            "side": existingOrder.side,
            "type": existingOrder.type,
            "price": existingOrder.price,
            "quantity": input.quantity
        }));
        multi.hget(`symbol:${input.symbol}:depth:${existingOrder.side}:qty`, input.price.toString()); // 해당 가격대 총 수량 조회
        const results = await multi.exec();
        const newTotalQty = parseInt(results![4][1] as string); // 마지막 결과에서 총 수량 가져오기

        if (results) { // 성공적으로 처리된 경우 SSE 알림 전송
            switch (input.status) {
                case "modified": // 주문 수정 알림
                    addOrderNotify(input.user_id, {
                        timestamp: Date.now(),
                        message_id: crypto.randomUUID(),
                        user_id: input.user_id,
                        order_id: input.order_id,
                        symbol: input.symbol!,
                        side: existingOrder.side,
                        type: existingOrder.type,
                        price: existingOrder.price,
                        quantity: input.quantity,
                        status: input.status as OrderStatus
                    });
                    break;
            }

            // 호가 변화 알림 큐에 추가
            addDepthUpdate(input.symbol!, existingOrder.side, [{price: existingOrder.price, quantity: newTotalQty}]);
        }
    } catch (e) {
        logger.error(`Failed to decrease order quantity: ${e}`);
        return false;
    }
}