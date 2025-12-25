import { z } from "zod";
import { rateLimitORPCMiddleware } from "$lib/server/middlewares/orpc.auth.middleware";
import {
    getChart,
    getChartTop,
    getLastUpdate,
    getPreviousTimestamp,
    getTick,
    getTickTop
} from "$lib/server/redis/presets/chart";
import { rpcBuilder } from "$lib/server/middlewares/orpc.builder";
import { TimeService } from "$lib/server/redis/time";

const tickData = z.object({
    timestamp: z.number().int().nonnegative(),
    price: z.number().nonnegative(),
    volume: z.number().nonnegative(),
});

const chartData = z.object({
    timestamp: z.number().int().nonnegative(),
    open: z.number().nonnegative(),
    high: z.number().nonnegative(),
    low: z.number().nonnegative(),
    close: z.number().nonnegative(),
    volume: z.number().nonnegative(),
});

const getTimestamp = z.object({
    symbol: z.string().min(1).trim().toUpperCase().regex(/^[ A-Z0-9]+$/, "Symbol must be uppercase alphanumeric"),
    interval: z.enum(['1t', '1s', '1m', '3m', '5m', '15m', '30m', '1h', '4h', '1D', '1W', '1M', '1Y']).default('1D'),
    before: z.int().optional()
})

const fetchChartDataSchema = getTimestamp.pick({
    symbol: true,
    interval: true
}).extend({
    startTime: z.number().int().nonnegative().optional(),
    endTime: z.number().int().nonnegative().optional(),
    limit: z.number().min(1).max(1000).default(500)
});

const fetchChartDataTopSchema = getTimestamp.pick({
    symbol: true,
    interval: true
}).extend({
    timestamp: z.number().int().nonnegative().optional(),
    count: z.number().min(1).max(1000).default(500)
});

// TODO: redis에 없거나 부족한 데이터는 postgresql 시계열 데이터베이스에서 가져오기
/**
 * 심볼의 특정 기간 사이의 차트 데이터를 limit개 만큼 가져옵니다.
 * - Rate Limit: 1분당 200회
 * @param symbol 심볼 (예: "NVDA")
 * @param interval 차트 간격 (예: "1t" (틱 데이터), "1m", "5m", "1h", "1D", "1W", "1M", "1Y" 등)
 * @param startTime 시작 타임스탬프 (밀리초 단위, 기본값: 0)
 * @param endTime 종료 타임스탬프 (밀리초 단위, 기본값: 현재 시간 + 1일)
 * @param limit 최대 데이터 포인트 수 (기본값: 500, 최대값: 1000)
 * @returns `{ symbol: string, interval: string, chart: [ { timestamp, open, high, low, close, volume }, ... ] }` - 오름차순으로 정렬된 차트 데이터 배열
 */
export const fetchChartData = rpcBuilder
    .use(rateLimitORPCMiddleware(200, 60))
    .input(fetchChartDataSchema)
    .handler(async ({input}) => {
        const startTime = input.startTime || 0;
        const endTime = input.endTime || await TimeService.now(); // 데이터 잘림 방지용

        if (input.interval === '1t') { // 틱 데이터 요청
            const tick = await getTick(input.symbol, startTime, endTime);
            const tickSlice = tick.slice(-input.limit); // limit 개수만큼 자르기
            return {
                symbol: input.symbol,
                interval: input.interval,
                chart: tickSlice as z.infer<typeof tickData>[]
            }
        }

        // 차트 데이터 요청
        const chart = await getChart(input.symbol, input.interval, startTime, endTime, { type: "fill", endTimestamp: endTime });
        const chartSlice = chart.slice(-input.limit); // limit 개수만큼 자르기

        return {
            symbol: input.symbol,
            interval: input.interval,
            chart: chartSlice as z.infer<typeof chartData>[]
        }
    });

/**
 * 심볼의 특정 타임스탬프를 기준으로 그 이전의 차트 데이터를 count개 만큼 가져옵니다.
 * - Rate Limit: 1분당 200회
 * @param symbol 심볼 (예: "NVDA")
 * @param interval 차트 간격 (예: "1t" (틱 데이터), "1m", "5m", "1h", "1D", "1W", "1M", "1Y" 등)
 * @param timestamp 기준 타임스탬프 (밀리초 단위, 기본값: 현재 시간 + 1일)
 * @param count 최대 데이터 포인트 수 (기본값: 500, 최대값: 1000)
 * @returns `{ symbol: string, interval: string, chart: [ { timestamp, open, high, low, close, volume }, ... ] }` - 오름차순으로 정렬된 차트 데이터 배열
 */
export const fetchChartDataTop = rpcBuilder
    .use(rateLimitORPCMiddleware(200, 60))
    .input(fetchChartDataTopSchema)
    .handler(async ({input}) => {
        const timestamp = input.timestamp || await TimeService.now(); // 데이터 잘림 방지용

        if (input.interval === '1t') { // 틱 데이터 요청
            const tick = await getTickTop(input.symbol, timestamp, input.count);

            return {
                symbol: input.symbol,
                interval: input.interval,
                chart: tick as z.infer<typeof tickData>[]
            }
        }

        const chart = await getChartTop(input.symbol, input.interval, timestamp, input.count, { type: "fill", endTimestamp: timestamp });

        return {
            symbol: input.symbol,
            interval: input.interval,
            chart: chart as z.infer<typeof chartData>[]
        }
    });


/**
 * 심볼의 가장 최근 차트 타임스탬프를 가져오거나, 특정 시간 이전의 가장 가까운 타임스탬프도 요청할 수 있습니다.
 * - Rate Limit: 1분당 200회
 * @param symbol 심볼 (예: "NVDA")
 * @param interval 차트 간격 (예: "1t" (틱 데이터), "1m", "5m", "1h", "1D", "1W", "1M", "1Y" 등)
 * @param before 특정 시간 이전의 가장 가까운 타임스탬프 (밀리초 단위, optional)
 * @returns `{ symbol: string, timestamp: number }` - 타임스탬프 (밀리초 단위, 없으면 -1 반환)
 */
export const getChartTimestamp = rpcBuilder
    .use(rateLimitORPCMiddleware(200, 60))
    .input(getTimestamp)
    .handler(async ({input}) => {
        if (input.before) { // 특정 시간 이전의 가장 가까운 타임스탬프 요청
            const timestamp = await getPreviousTimestamp(input.symbol, input.interval, input.before);

            return {
                symbol: input.symbol,
                timestamp // 없으면 -1 반환
            }
        }

        const timestamp = await getLastUpdate(input.symbol);

        return {
            symbol: input.symbol,
            timestamp // 없으면 -1 반환
        }
    });