import PQueue from "p-queue";
import { logger } from "../../utils/logger";
import { EventEmitter } from 'events';
import { processOrder } from "$lib/server/ProcessOrder";

export type OrderAction = 'open' | 'modify' | 'cancel';
type OrderState = 'pending' | 'executing' | 'completed' | 'failed' | 'cancelled';

interface QueuedOrder {
    orderId: string;
    symbol: string;
    action: OrderAction;
    state: OrderState;
    data: { input: any, symbol: any, priority?: number };
    addedAt: number;
    startedAt?: number;
    completedAt?: number;
}

export class OrderQueue extends EventEmitter {
    private queues = new Map<string, PQueue>();
    private orders = new Map<string, QueuedOrder>();
    private cancelled = new Set<string>();
    private ordersBySymbol = new Map<string, Set<string>>();
    private completedResults = new Map<string, {
        success: boolean,
        result?: any,
        error?: any,
        timestamp: number
    }>();

    constructor() {
        super();

        setInterval(() => {
            const now = Date.now();
            for (const [key, data] of this.completedResults.entries()) {
                if (now - data.timestamp > 300000) {
                    this.completedResults.delete(key);
                }
            }
        }, 60000);
    }

    private getQueue(symbol: string): PQueue {
        if (!this.queues.has(symbol)) {
            this.queues.set(symbol, new PQueue({concurrency: 1}));
        }
        return this.queues.get(symbol)!;
    }

    private makeKey(symbol: string, orderId: string, action: OrderAction): string {
        return `${symbol}:${orderId}:${action}`;
    }

    async submitOrder(symbol: string, orderId: string, action: OrderAction, data: {
        input: any,
        symbol: any,
        priority?: number
    }) {
        const key = this.makeKey(symbol, orderId, action);

        if (this.orders.has(key)) {
            return {
                success: false,
                reason: 'already-in-queue'
            };
        }

        const queuedOrder: QueuedOrder = {
            orderId,
            symbol,
            action,
            state: 'pending',
            data,
            addedAt: Date.now()
        };

        this.orders.set(key, queuedOrder);

        if (!this.ordersBySymbol.has(symbol)) {
            this.ordersBySymbol.set(symbol, new Set());
        }
        this.ordersBySymbol.get(symbol)!.add(key);

        this.emit('orderQueue-added', {symbol, orderId, action});

        const priority = data?.priority ?? 0;
        const queue = this.getQueue(symbol);

        try {
            return await queue.add(async () => {
                queuedOrder.state = 'executing';
                queuedOrder.startedAt = Date.now();

                this.emit('orderQueue-started', {symbol, orderId, action});

                if (this.cancelled.has(key)) {
                    this.cancelled.delete(key);
                    queuedOrder.state = 'cancelled';
                    queuedOrder.completedAt = Date.now();

                    const cancelResult = {
                        success: false,
                        error: 'cancelled'
                    };

                    this.completedResults.set(key, {
                        ...cancelResult,
                        timestamp: Date.now()
                    });

                    this.emit('order-cancelled', {symbol, orderId, action});
                    this.emit(`order:${key}:finish`, cancelResult);

                    return cancelResult;
                }

                try {
                    const execResult = await this.executeAction(data);
                    queuedOrder.state = 'completed';
                    queuedOrder.completedAt = Date.now();

                    const successResult = {
                        success: true,
                        result: execResult
                    };

                    this.completedResults.set(key, {
                        ...successResult,
                        timestamp: Date.now()
                    });

                    this.emit('order-completed', {symbol, orderId, action, result: execResult});
                    this.emit(`order:${key}:finish`, successResult);

                    return successResult;
                } catch (error) {
                    queuedOrder.state = 'failed';
                    queuedOrder.completedAt = Date.now();

                    const failResult = {
                        success: false,
                        error
                    };

                    this.completedResults.set(key, {
                        ...failResult,
                        timestamp: Date.now()
                    });

                    this.emit('order-failed', {symbol, orderId, action, error});
                    this.emit(`order:${key}:finish`, failResult);

                    return failResult;
                }
            }, {priority});
        } finally {
            setTimeout(() => {
                this.orders.delete(key);
                this.ordersBySymbol.get(symbol)?.delete(key);
                this.completedResults.delete(key);
            }, 60000);
        }
    }

    private async executeAction(data: {
        input: any,
        symbol: any,
        priority?: number
    }) {
        await processOrder(data.input, data.symbol);
    }

    isInQueue(symbol: string, orderId: string, action: OrderAction): boolean {
        const key = this.makeKey(symbol, orderId, action);
        const order = this.orders.get(key);
        return order !== undefined &&
            (order.state === 'pending' || order.state === 'executing');
    }

    getOrderStatus(symbol: string, orderId: string, action: OrderAction): QueuedOrder | undefined {
        const key = this.makeKey(symbol, orderId, action);
        return this.orders.get(key);
    }

    cancelQueuedOrder(symbol: string, orderId: string, action: OrderAction): boolean {
        const key = this.makeKey(symbol, orderId, action);

        const order = this.orders.get(key);
        if (!order) {
            return false;
        }

        if (order.state === 'executing') {
            logger.info(`Order ${key} is executing, cannot cancel`);
            return false;
        }

        this.cancelled.add(key);
        logger.info(`Order ${key} marked for cancellation`);
        return true;
    }

    clearSymbol(symbol: string) {
        const queue = this.queues.get(symbol);
        if (queue) {
            queue.clear();
        }

        const symbolKeys = this.ordersBySymbol.get(symbol);
        if (symbolKeys) {
            for (const key of symbolKeys) {
                const order = this.orders.get(key);
                if (order && order.state === 'pending') {
                    this.cancelled.add(key);
                }
            }
        }

        logger.info(`Symbol ${symbol} cleared`);
    }

    clearAll() {
        for (const queue of this.queues.values()) {
            queue.clear();
        }
        this.cancelled.clear();
        logger.info('All symbols cleared');
    }

    getSymbolStatus(symbol: string, includeOrders = false): {
        pending: number,
        executing: number,
        orders?: QueuedOrder[]
    } {
        const queue = this.queues.get(symbol);

        if (!queue) {
            return {
                pending: 0,
                executing: 0,
                ...(includeOrders && {orders: []})
            };
        }

        const result: any = {
            pending: queue.size,
            executing: queue.pending
        };

        if (includeOrders) {
            const symbolKeys = this.ordersBySymbol.get(symbol);
            const orders: QueuedOrder[] = [];

            if (symbolKeys) {
                for (const key of symbolKeys) {
                    const order = this.orders.get(key);
                    if (order && (order.state === 'pending' || order.state === 'executing')) {
                        orders.push(order);
                    }
                }
            }

            result.orders = orders;
        }

        return result;
    }

    getAllStatus(includeOrders = false): Record<string, {
        pending: number,
        executing: number,
        orders?: QueuedOrder[]
    }> {
        const status: Record<string, any> = {};

        for (const [symbol, queue] of this.queues.entries()) {
            status[symbol] = {
                pending: queue.size,
                executing: queue.pending
            };

            if (includeOrders) {
                const symbolKeys = this.ordersBySymbol.get(symbol);
                const orders: QueuedOrder[] = [];

                if (symbolKeys) {
                    for (const key of symbolKeys) {
                        const order = this.orders.get(key);
                        if (order && (order.state === 'pending' || order.state === 'executing')) {
                            orders.push(order);
                        }
                    }
                }

                status[symbol].orders = orders;
            }
        }

        return status;
    }

    getStats(): { totalOrders: number, pending: number, executing: number, cancelled: number, symbols: number } {
        const stats = {
            totalOrders: this.orders.size,
            pending: 0,
            executing: 0,
            cancelled: this.cancelled.size,
            symbols: this.queues.size
        };

        for (const order of this.orders.values()) {
            if (order.state === 'pending') stats.pending++;
            if (order.state === 'executing') stats.executing++;
        }

        return stats;
    }

    onOrderFinish(symbol: string, orderId: string, action: OrderAction, callback: (result: {
        success: boolean,
        result?: any,
        error?: any
    }) => void) {
        const key = this.makeKey(symbol, orderId, action);

        const completed = this.completedResults.get(key);
        if (completed) {
            setImmediate(() => callback(completed));
            return;
        }

        this.once(`order:${key}:finish`, callback);
    }

    getOrderResult(symbol: string, orderId: string, action: OrderAction) {
        const key = this.makeKey(symbol, orderId, action);
        return this.completedResults.get(key);
    }
}