import { redis } from "$lib/server/redis/db";
import {
    getNextTimestamp,
    getSupportedIntervals,
    getTimestamp,
    intervalToMilliseconds
} from "../../../../utils/timestamp";
import { logger } from "../../../../utils/logger";
import { broadcastToDataClients, hasDataClient } from "$lib/server/sse";

type chartType = {
    timestamp: number,
    open: number,
    high: number,
    low: number,
    close: number,
    volume: number,
}

type tickType = {
    timestamp: number,
    price: number,
    volume: number,
}

function getRetention(interval: string): number {
    const retentions: Record<string, number> = {
        '1s': 7 * 24 * 60 * 60 * 1000, // 1주
        '1m': 14 * 24 * 60 * 60 * 1000, // 2주
        '3m': 30 * 24 * 60 * 60 * 1000, // 1개월
        '5m': 60 * 24 * 60 * 60 * 1000, // 2개월
        '15m': 120 * 24 * 60 * 60 * 1000, // 4개월
        '30m': 180 * 24 * 60 * 60 * 1000, // 6개월
        '1h': 180 * 24 * 60 * 60 * 1000, // 6개월
        '4h': 360 * 24 * 60 * 60 * 1000, // 1년
        '1d': 2 * 365 * 24 * 60 * 60 * 1000 // 2년
    };
    return retentions[interval] || 0;
}

// TODO: postgresql 시계열 데이터베이스에 '틱 데이터' & '캔들 데이터' 저장하기
/**
 * 심볼의 틱 데이터 배치를 저장합니다.
 * @param symbol 심볼
 * @param ticks 틱 데이터 배열 [{ price, volume, timestamp? }, ...]
 */
export async function saveTickBatch(symbol: string, ticks: Array<{ price: number, volume: number, timestamp?: number }>) {
    await initChart(symbol); // TimeSeries 다운샘플링 초기화

    const pipeline = redis.pipeline();
    for (const tick of ticks) {
        const timestamp = tick.timestamp ?? '*';
        pipeline.call('TS.ADD', `symbol:${symbol}:1t:price`, timestamp, tick.price, 'ON_DUPLICATE', 'LAST');
        pipeline.call('TS.ADD', `symbol:${symbol}:1t:volume`, timestamp, tick.volume, 'ON_DUPLICATE', 'SUM');
    }
    const res = await pipeline.exec();
    const timestamps = new Set<number>();
    for (let i = 0; i < res!.length; i += 2) {
        const priceTimestamp = res?.[i]?.[1] as number;
        timestamps.add(priceTimestamp);
    }

    await updateLongTermChartBatch(symbol, Array.from(timestamps), ticks);

    broadcastChartUpdatesBatch(symbol, Array.from(timestamps)).catch(error => {
        logger.warn(`Failed to broadcast chart updates: ${error.message}`);
    });
}

/**
 * 심볼의 특정 인터벌 봉 데이터를 시작~끝 타임스탬프 사이에서 가져옵니다.
 * @param symbol 심볼
 * @param interval 인터벌 (지원하는 인터벌: {@link getSupportedIntervals})
 * @param start 시작 타임스탬프 (밀리초 단위)
 * @param end 끝 타임스탬프 (밀리초 단위)
 * @param gap - (선택사항) 거래가 없는 구간을 이전 종가로 채울지 여부 및 끝 타임스탬프 ({ type: 'fill' | 'none', endTimestamp?: number }, 기본값: { type: 'none' })
 * @return 봉 데이터 배열 [{timestamp, open, high, low, close, volume}, ...]
 * @throws 지원하지 않는 인터벌에 대해 오류를 발생시킴
 */
export async function getChart(symbol: string, interval: string, start: number, end: number, gap: { type: 'fill' | 'none', endTimestamp?: number } = { type: 'none' }): Promise<chartType[]> {
    const supportedIntervals = getSupportedIntervals(0);
    if (!supportedIntervals.includes(interval)) {
        throw new Error(`Unsupported interval: ${interval}`);
    }

    let charts = []

    try {
        if (getSupportedIntervals(1).includes(interval)) {
            const includeLatest = true; // 가장 최근 데이터 포함 여부

            const [openData, highData, lowData, closeData, volumeData] = await Promise.all([
                redis.call('TS.RANGE', `symbol:${symbol}:${interval}:open`, start, end, ...(includeLatest ? ['LATEST'] : [])),
                redis.call('TS.RANGE', `symbol:${symbol}:${interval}:high`, start, end, ...(includeLatest ? ['LATEST'] : [])),
                redis.call('TS.RANGE', `symbol:${symbol}:${interval}:low`, start, end, ...(includeLatest ? ['LATEST'] : [])),
                redis.call('TS.RANGE', `symbol:${symbol}:${interval}:close`, start, end, ...(includeLatest ? ['LATEST'] : [])),
                redis.call('TS.RANGE', `symbol:${symbol}:${interval}:volume`, start, end, ...(includeLatest ? ['LATEST'] : []))
            ]) as Array<Array<[number, string]>>;

            const length = openData.length;
            for (let i = 0; i < length; i++) {
                charts.push({
                    timestamp: openData[i][0],
                    open: parseFloat(openData[i][1]),
                    high: parseFloat(highData[i][1]),
                    low: parseFloat(lowData[i][1]),
                    close: parseFloat(closeData[i][1]),
                    volume: parseFloat(volumeData[i][1]),
                });
            }
        } else {
            const entries = await redis.zrange(`symbol:${symbol}:${interval}:charts`, start, end, 'BYSCORE', 'WITHSCORES');

            for (let i = 0; i < entries.length; i += 2) {
                const parts = entries[i].split('|');
                charts.push({
                    timestamp: parseInt(entries[i + 1]),
                    open: parseFloat(parts[0]),
                    high: parseFloat(parts[1]),
                    low: parseFloat(parts[2]),
                    close: parseFloat(parts[3]),
                    volume: parseFloat(parts[4]),
                });
            }
        }

        return gap.type === "fill" ? await fillGapCharts(charts, interval, Number.MAX_SAFE_INTEGER, gap.endTimestamp) : charts;
    } catch {
        return [];
    }
}

/**
 * 심볼의 틱 데이터를 시작~끝 타임스탬프 사이에서 가져옵니다.
 * @param symbol 심볼
 * @param start 시작 타임스탬프 (밀리초 단위)
 * @param end 끝 타임스탬프 (밀리초 단위)
 * @return 틱 데이터 배열 [{timestamp, price, volume}, ...]
 */
export async function getTick(symbol: string, start: number, end: number): Promise<tickType[]> {
    try {
        const [priceData, volumeData] = await Promise.all([
            redis.call('TS.RANGE', `symbol:${symbol}:1t:price`, start, end),
            redis.call('TS.RANGE', `symbol:${symbol}:1t:volume`, start, end)
        ]) as Array<Array<[number, string]>>;

        const ticks = [];
        const length = priceData.length;
        for (let i = 0; i < length; i++) {
            ticks.push({
                timestamp: priceData[i][0],
                price: parseFloat(priceData[i][1]),
                volume: parseFloat(volumeData[i][1]),
            });
        }
        return ticks;
    } catch {
        return [];
    }
}

/**
 * 심볼의 특정 timestamp를 기준으로 과거 n개의 봉 데이터를 가져옵니다.
 * @param symbol 심볼
 * @param interval 인터벌 (지원하는 인터벌: {@link getSupportedIntervals})
 * @param timestamp 기준 타임스탬프 (밀리초 단위)
 * @param count 가져올 봉 개수 (최대 10000)
 * @param gap (선택사항) 거래가 없는 구간을 이전 종가로 채울지 여부 및 끝 타임스탬프 ({ type: 'fill' | 'none', endTimestamp?: number }, 기본값: { type: 'none' })
 * @return 봉 데이터 배열 [{timestamp, open, high, low, close, volume}, ...]
 * @throws 지원하지 않는 인터벌에 대해 오류를 발생시킴
 */
export async function getChartTop(symbol: string, interval: string, timestamp: number, count: number, gap: { type: 'fill' | 'none', endTimestamp?: number } = { type: 'none' }): Promise<chartType[]> {
    const supportedIntervals = getSupportedIntervals(0);
    if (!supportedIntervals.includes(interval)) {
        throw new Error(`Unsupported interval: ${interval}`);
    }
    if (count < 1 || count > 10000) {
        throw new Error('Count must be between 1 and 10000');
    }

    let charts = []

    try {
        if (getSupportedIntervals(1).includes(interval)) {
            const includeLatest = true; // 가장 최근 데이터 포함 여부

            const [openData, highData, lowData, closeData, volumeData] = await Promise.all([
                redis.call('TS.REVRANGE', `symbol:${symbol}:${interval}:open`, '-', timestamp, 'COUNT', count, ...(includeLatest ? ['LATEST'] : [])),
                redis.call('TS.REVRANGE', `symbol:${symbol}:${interval}:high`, '-', timestamp, 'COUNT', count, ...(includeLatest ? ['LATEST'] : [])),
                redis.call('TS.REVRANGE', `symbol:${symbol}:${interval}:low`, '-', timestamp, 'COUNT', count, ...(includeLatest ? ['LATEST'] : [])),
                redis.call('TS.REVRANGE', `symbol:${symbol}:${interval}:close`, '-', timestamp, 'COUNT', count, ...(includeLatest ? ['LATEST'] : [])),
                redis.call('TS.REVRANGE', `symbol:${symbol}:${interval}:volume`, '-', timestamp, 'COUNT', count, ...(includeLatest ? ['LATEST'] : []))
            ]) as Array<Array<[number, string]>>;

            for (let i = openData.length - 1; i >= 0; i--) {
                charts.push({
                    timestamp: openData[i][0],
                    open: parseFloat(openData[i][1]),
                    high: parseFloat(highData[i][1]),
                    low: parseFloat(lowData[i][1]),
                    close: parseFloat(closeData[i][1]),
                    volume: parseFloat(volumeData[i][1]),
                });
            }
        } else {
            const entries = await redis.zrevrange(
                `symbol:${symbol}:${interval}:charts`,
                0,
                count - 1,
                'WITHSCORES'
            );
            for (let i = entries.length - 2; i >= 0; i -= 2) {
                const parts = entries[i].split('|');
                charts.push({
                    timestamp: parseInt(entries[i + 1]),
                    open: parseFloat(parts[0]),
                    high: parseFloat(parts[1]),
                    low: parseFloat(parts[2]),
                    close: parseFloat(parts[3]),
                    volume: parseFloat(parts[4]),
                });
            }
        }

        return gap.type === "fill" ? await fillGapCharts(charts, interval, count, gap.endTimestamp) : charts;
    } catch {
        return [];
    }
}

/**
 * 심볼의 특정 timestamp를 기준으로 이전 n개의 틱 데이터를 가져옵니다.
 * @param symbol 심볼
 * @param timestamp 기준 타임스탬프 (밀리초 단위)
 * @param count 가져올 틱 개수 (최대 10000)
 * @return 틱 데이터 배열 [{timestamp, price, volume}, ...]
 * @throws 지원하지 않는 인터벌에 대해 오류를 발생시킴
 */
export async function getTickTop(symbol: string, timestamp: number, count: number): Promise<tickType[]> {
    if (count < 1 || count > 10000) {
        throw new Error('Count must be between 1 and 10000');
    }

    try {
        const [priceData, volumeData] = await Promise.all([
            redis.call('TS.REVRANGE', `symbol:${symbol}:1t:price`, '-', timestamp, 'COUNT', count),
            redis.call('TS.REVRANGE', `symbol:${symbol}:1t:volume`, '-', timestamp, 'COUNT', count)
        ]) as Array<Array<[number, string]>>;

        const ticks = [];
        for (let i = priceData.length - 1; i >= 0; i--) {
            ticks.push({
                timestamp: priceData[i][0],
                price: parseFloat(priceData[i][1]),
                volume: parseFloat(volumeData[i][1]),
            });
        }
        return ticks;
    } catch {
        return [];
    }
}

/**
 * 심볼의 마지막 업데이트 타임스탬프를 가져옵니다.
 * @param symbol 심볼
 * @return 마지막 업데이트 타임스탬프 (밀리초 단위), 데이터가 없으면 Infinity 반환
 */
export async function getLastUpdate(symbol: string): Promise<number> {
    try {
        const lastUpdate = await redis.call('TS.GET', `symbol:${symbol}:1t:price`);
        if (!lastUpdate) {
            return -1; // 데이터가 없으면 -1 반환
        }
        return (lastUpdate as [number, string])[0];
    } catch (error) {
        return -1; // 에러 발생 시 -1 반환
    }
}

/**
 * 심볼의 특정 timestamp의 바로 이전 timestamp를 가져옵니다.
 * @param symbol 심볼
 * @param interval 인터벌 (지원하는 인터벌: {@link getSupportedIntervals})
 * @param timestamp 기준 타임스탬프 (밀리초 단위)
 * @return 바로 이전 타임스탬프 (밀리초 단위), 데이터가 없으면 -1 반환
 * @throws 지원하지 않는 인터벌에 대해 오류를 발생시킴
 */
export async function getPreviousTimestamp(symbol: string, interval: string, timestamp: number): Promise<number> {
    const supportedIntervals = getSupportedIntervals(0);
    if (!supportedIntervals.includes(interval)) {
        throw new Error(`Unsupported interval: ${interval}`);
    }

    try {
        if (getSupportedIntervals(1).includes(interval)) {
            const includeLatest = true; // 가장 최근 데이터 포함 여부

            const result = await redis.call('TS.REVRANGE', `symbol:${symbol}:${interval}:close`, '-', timestamp - 1, 'COUNT', 1, ...(includeLatest ? ['LATEST'] : []));
            if (result && (result as Array<[number, string]>).length > 0) {
                return (result as Array<[number, string]>)[0][0];
            }
        } else {
            const entries = await redis.zrevrangebyscore(
                `symbol:${symbol}:${interval}:charts`,
                timestamp - 1,
                '-inf',
                'WITHSCORES',
                'LIMIT',
                0,
                1
            );

            if (entries.length >= 2) {
                return parseInt(entries[1]); // 바로 이전 타임스탬프 반환
            }
        }
        return -1; // 이전 데이터가 없으면 -1 반환
    } catch (error) {
        return -1; // 에러 발생 시 -1 반환
    }
}

async function broadcastChartUpdatesBatch(symbol: string, timestamps: number[]) {
    const intervals = getSupportedIntervals(0);

    const affectedCharts = new Map<string, Set<number>>();

    for (const interval of intervals) {
        if (!hasDataClient(symbol, {interval, chart: true})) continue;

        const chartTimestamps = new Set<number>();
        for (const timestamp of timestamps) {
            chartTimestamps.add(getTimestamp(timestamp, interval));
        }
        affectedCharts.set(interval, chartTimestamps);
    }

    const updateId = await redis.incr(`symbol:${symbol}:chart:updateId`);

    await Promise.all(
        Array.from(affectedCharts.entries()).map(async ([interval, chartTimestamps]) => {
            const allCharts = await getChart(symbol, interval, Math.min(...Array.from(chartTimestamps)), Math.max(...Array.from(chartTimestamps)));

            await broadcastToDataClients(symbol, 'chart', JSON.stringify({
                type: 'update',
                interval: interval,
                updateId,
                chart: allCharts,
            }), {interval: interval, chart: true}).catch(() => {
                logger.warn(`Failed to broadcast chart batch for ${symbol} ${interval}`);
            });
        })
    );
}


const initializedTS = new Set<string>(); // 서버 시작 후 TimeSeries 다운샘플링이 초기화된 심볼 목록

async function initChart(symbol: string) {
    if (initializedTS.has(symbol)) return; // 이미 초기화된 심볼이면 무시

    const pipeline = redis.pipeline(); // 여러개 명령어를 한번에 처리하기 위한 파이프라인
    initializedTS.add(symbol); // 심볼을 초기화된 목록에 추가

    pipeline.call('TS.CREATE', `symbol:${symbol}:1t:price`,
        // 'RETENTION', 3600000,  // 1시간
        'CHUNK_SIZE', 4096,
        'LABELS', 'symbol', symbol, 'interval', '1t', 'type', 'price'
    );

    pipeline.call('TS.CREATE', `symbol:${symbol}:1t:volume`,
        // 'RETENTION', 3600000,  // 1시간
        'CHUNK_SIZE', 4096,
        'LABELS', 'symbol', symbol, 'interval', '1t', 'type', 'volume'
    );

    const keys = ['open', 'high', 'low', 'close', 'volume'];

    const intervals = getSupportedIntervals(1); // Redis TimeSeries로 지원하는 모든 간격 가져오기

    for (const interval of intervals) { // 각 간격에 대해 다운샘플링 규칙 설정
        for (const key of keys) { // 각 간격의 open, high, low, close, volume 테이블을 생성
            pipeline.call('TS.CREATE', `symbol:${symbol}:${interval}:${key}`,
                // 'RETENTION', getRetention(interval), // 각 간격에 맞는 보존 기간 설정
                'CHUNK_SIZE', 4096, // 청크 크기 설정
                'LABELS', 'symbol', symbol, 'interval', interval, 'type', key // 메타데이터 라벨
            );
        }

        // 다운샘플링 규칙 설정
        pipeline.call('TS.CREATERULE', `symbol:${symbol}:1t:price`, `symbol:${symbol}:${interval}:open`, 'AGGREGATION', 'first', intervalToMilliseconds(interval));
        pipeline.call('TS.CREATERULE', `symbol:${symbol}:1t:price`, `symbol:${symbol}:${interval}:high`, 'AGGREGATION', 'max', intervalToMilliseconds(interval));
        pipeline.call('TS.CREATERULE', `symbol:${symbol}:1t:price`, `symbol:${symbol}:${interval}:low`, 'AGGREGATION', 'min', intervalToMilliseconds(interval));
        pipeline.call('TS.CREATERULE', `symbol:${symbol}:1t:price`, `symbol:${symbol}:${interval}:close`, 'AGGREGATION', 'last', intervalToMilliseconds(interval));
        pipeline.call('TS.CREATERULE', `symbol:${symbol}:1t:volume`, `symbol:${symbol}:${interval}:volume`, 'AGGREGATION', 'sum', intervalToMilliseconds(interval));
    }

    // 1주, 1개월, 1년 봉은 Sorted Set 으로 관리 (압축할 필요가 거의 없기 때문)

    try {
        await pipeline.exec(); // 파이프라인에 담긴 모든 명령어 실행
    } catch (error) {
        // 이미 존재하는 키 에러는 무시
        if (!(error as any).message.includes('already exists')) {
            logger.warn(`Failed to initialize TimeSeries for ${symbol}: ${(error as any).message}`); // 기타 에러는 로그 남기기
        }
    }
}

async function updateLongTermChartBatch(symbol: string, timestamps: number[], ticks: Array<{ price: number, volume: number }>) {
    const intervals = getSupportedIntervals(2);

    // language=Lua
    const script = `
        local key = KEYS[1]
        local chartTimestamp = tonumber(ARGV[1])
        local openPrice = tonumber(ARGV[2])
        local closePrice = tonumber(ARGV[3])
        local lowPrice = tonumber(ARGV[4])
        local highPrice = tonumber(ARGV[5])
        local volumeDelta = tonumber(ARGV[6])

        -- 해당 timestamp의 데이터 조회
        local existing = redis.call('ZRANGEBYSCORE', key, chartTimestamp, chartTimestamp)

        local open, high, low, close, vol
        if #existing > 0 then
            local parts = {}
            local i = 1
            for val in string.gmatch(existing[1], "([^|]+)") do
                parts[i] = tonumber(val)
                i = i + 1
            end

            open = parts[1]
            high = math.max(parts[2], highPrice)
            low = math.min(parts[3], lowPrice)
            close = closePrice
            vol = parts[5] + volumeDelta
        else
            open = openPrice
            high = highPrice
            low = lowPrice
            close = closePrice
            vol = volumeDelta
        end

        redis.call('ZREMRANGEBYSCORE', key, chartTimestamp, chartTimestamp)

        local chartData = open .. '|' .. high .. '|' .. low .. '|' .. close .. '|' .. vol
        redis.call('ZADD', key, chartTimestamp, chartData)

        return chartData
    `;

    const updates: Array<{interval: string, chartTimestamp: number, price: number, volume: number}> = [];

    for (let i = 0; i < timestamps.length; i++) {
        const timestamp = timestamps[i];
        const tick = ticks[i];

        for (const interval of intervals) {
            const chartTimestamp = getTimestamp(timestamp, interval);
            updates.push({
                interval,
                chartTimestamp,
                price: tick.price,
                volume: tick.volume
            });
        }
    }

    const grouped = new Map<string, Array<{interval: string, chartTimestamp: number, price: number, volume: number}>>();

    for (const update of updates) {
        const key = `${update.interval}:${update.chartTimestamp}`;
        if (!grouped.has(key)) {
            grouped.set(key, []);
        }
        grouped.get(key)!.push(update);
    }

    await Promise.all(
        Array.from(grouped.entries()).map(async ([_, items]) => {
            const firstPrice = items[0].price;
            const lastPrice = items[items.length - 1].price;

            let minPrice = firstPrice;
            let maxPrice = firstPrice;
            let totalVolume = 0;

            for (const item of items) {
                minPrice = Math.min(minPrice, item.price);
                maxPrice = Math.max(maxPrice, item.price);
                totalVolume += item.volume;
            }

            await redis.eval(script, 1,
                `symbol:${symbol}:${items[0].interval}:charts`,
                items[0].chartTimestamp,
                firstPrice,
                lastPrice,
                minPrice,
                maxPrice,
                totalVolume
            );
        })
    );
}

async function fillGapCharts(charts: any[], interval: string, count: number, endTimestamp?: number): Promise<chartType[]> {
    if (charts.length === 0) return [];

    const intervalMs = intervalToMilliseconds(interval);
    const chartMap = new Map(charts.map(c => [c.timestamp, c]));
    const startTS = charts[0].timestamp;
    const endTs = endTimestamp ?? charts[charts.length - 1].timestamp;

    const result = await redis.zrange('exchange:session', startTS, endTs, 'BYSCORE', 'WITHSCORES');

    const sessionChanges: Array<{ status: number; timestamp: number }> = [];
    for (let i = 0; i < result.length; i += 2) {
        sessionChanges.push({
            status: parseInt(result[i].split(':')[0]),
            timestamp: parseInt(result[i + 1])
        });
    }

    const totalSlots = Math.floor((endTs - startTS) / intervalMs) + 1;

    const buffer: (chartType | null)[] = new Array(count).fill(null);
    let writeIdx = 0;
    let size = 0;

    let lastClose = charts[0].close;
    let sessionIndex = 0;
    let currentStatus = 1;

    let ts = startTS

    for (let i = 0; i < totalSlots; i++) {
        while (sessionIndex < sessionChanges.length && sessionChanges[sessionIndex].timestamp <= ts) {
            currentStatus = sessionChanges[sessionIndex].status;
            sessionIndex++;
        }

        const existing = chartMap.get(ts);
        let chart: chartType | null = null;

        if (existing) {
            chart = existing;
            lastClose = existing.close;
        } else if (currentStatus !== 3) {
            chart = {
                timestamp: ts,
                open: lastClose,
                high: lastClose,
                low: lastClose,
                close: lastClose,
                volume: 0
            };
        }

        if (chart) {
            buffer[writeIdx] = chart;
            writeIdx = (writeIdx + 1) % count;
            if (size < count) size++;
        }

        ts = getNextTimestamp(ts, interval);
    }

    const out: chartType[] = new Array(size);
    const start = (writeIdx - size + count) % count;
    for (let i = 0; i < size; i++) {
        out[i] = buffer[(start + i) % count] as chartType;
    }
    return out;
}