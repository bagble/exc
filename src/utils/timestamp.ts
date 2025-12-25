import type {PJSe} from "$lib/server/loader/loader";

/**
 * 지원되는 타임스탬프 인터벌을 반환합니다. (최소 1초 이상: 틱 데이터는 제외)
 * @param rtn 0: 지원하는 인터벌 전부 반환, 1: Redis TimeSeries를 사용하는 인터벌만 반환, 2: Redis TimeSeries를 사용하지 않는 인터벌만 반환
 * @return 인터벌 문자열 배열
 */
export function getSupportedIntervals(rtn: number): string[] {
    const redisTSIntervals = ['1s', '1m', '3m', '5m', '15m', '30m', '1h', '4h'];
    const nonRedisTSIntervals = ['1D', '1W', '1M', '1Y'];

    if (rtn === 0) return [...redisTSIntervals, ...nonRedisTSIntervals];
    if (rtn === 1) return redisTSIntervals;
    if (rtn === 2) return nonRedisTSIntervals;
    throw new Error("Invalid parameter: rtn must be 0, 1, or 2");
}

/**
 * 주어진 인터벌 문자열을 밀리초 단위로 변환합니다.
 * @param interval 인터벌 문자열 (지원하는 인터벌: {@link getSupportedIntervals})
 * @returns 변환된 밀리초 값
 * @throws 지원하지 않는 인터벌에 대해 오류를 발생시킴
 */
export function intervalToMilliseconds(interval: string): number {
    const intervalInt = parseInt(interval.slice(0, -1))

    if (interval === 'tick') return 1;
    if (interval === '1t') return 1;
    if (interval.endsWith('s')) return intervalInt * 1000;
    if (interval.endsWith('m')) return intervalInt * 60 * 1000;
    if (interval.endsWith('h')) return intervalInt * 60 * 60 * 1000;

    switch (interval) {
        case '1D':
            return 24 * 60 * 60 * 1000; // 1일
        case '1W':
            return 7 * 24 * 60 * 60 * 1000; // 1주
        case '1M':
            return 30 * 24 * 60 * 60 * 1000; // 1개월 (대략)
        case '1Y':
            return 365 * 24 * 60 * 60 * 1000; // 1년 (대략)
        default:
            throw new Error(`Unsupported interval: ${interval}`);
    }
}

/**
 * 주어진 타임스탬프를 특정 인터벌의 시작 타임스탬프로 변환합니다.
 * @param timestamp 현재 타임스탬프 (밀리초 단위 포함)
 * @param interval 인터벌 문자열 (지원하는 인터벌: {@link getSupportedIntervals})
 * @returns 변환된 타임스탬프 (밀리초 단위)
 * @throws 지원하지 않는 인터벌에 대해 오류를 발생시킴
 */
export function getTimestamp(timestamp: number, interval: string): number {
    const exchange = (globalThis as any).exchange as PJSe;
    const offset = exchange.default_UTC_offset * 60 * 60 * 1000;

    const intervalInt = parseInt(interval.slice(0, -1))

    if (['tick', '1t'].includes(interval)) return timestamp;
    if (interval.endsWith('s')) return Math.floor(timestamp / (intervalInt * 1000)) * (intervalInt * 1000);
    if (interval.endsWith('m')) return Math.floor(timestamp / (intervalInt * 60 * 1000)) * (intervalInt * 60 * 1000);
    if (interval.endsWith('h')) return Math.floor(timestamp / (intervalInt * 60 * 60 * 1000)) * (intervalInt * 60 * 60 * 1000);

    switch (interval) {
        case '1D': {
            return Math.floor((timestamp + offset) / 86400000) * 86400000 - offset;
        }

        case '1W': {
            const date = new Date(timestamp + offset);
            const daysToSunday = date.getUTCDay();

            return Math.floor((timestamp + offset) / 86400000) * 86400000 - daysToSunday * 86400000 - offset;
        }

        case '1M': {
            const date = new Date(timestamp + offset);

            return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0) - offset;
        }

        case '1Y': {
            const date = new Date(timestamp + offset);

            return Date.UTC(date.getUTCFullYear(), 0, 1, 0, 0, 0, 0) - offset;
        }

        default:
            throw new Error(`Unsupported interval: ${interval}`);
    }
}

/**
 * 주어진 타임스탬프에서 특정 인터벌의 다음 타임스탬프를 계산합니다.
 * @param timestamp 현재 타임스탬프 (밀리초 단위 포함)
 * @param interval 인터벌 문자열 (지원하는 인터벌: {@link getSupportedIntervals})
 * @returns 다음 타임스탬프 (밀리초 단위)
 * @throws 지원하지 않는 인터벌에 대해 오류를 발생시킴
 */
export function getNextTimestamp(timestamp: number, interval: string): number {
    const offset = (globalThis as any).exchange.default_UTC_offset * 60 * 60 * 1000;
    const date = new Date(timestamp + offset);

    if (interval === '1M') {
        const year = date.getUTCFullYear();
        const month = date.getUTCMonth();

        return Date.UTC(year, month + 1, 1, 0, 0, 0, 0) - offset;
    }

    if (interval === '1Y') {
        const year = date.getUTCFullYear();

        return Date.UTC(year + 1, 0, 1, 0, 0, 0, 0) - offset;
    }

    return getTimestamp(timestamp, interval) + intervalToMilliseconds(interval);
}