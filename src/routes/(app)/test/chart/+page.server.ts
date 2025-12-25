import type {PageServerLoad} from "./$types";
import type {PJSe} from "$lib/server/loader/loader";

export const load: PageServerLoad = async ({ url }) => {
    const interval = url.searchParams.get('interval') || '1D'; // 기본값을 '1D'로 설정 (1일)
    const symbol = url.searchParams.get('symbol') || 'EXC'; // 기본값을 'EXC'로 설정 (테스트용 심볼)

    const exchange = (globalThis as any).exchange as PJSe;
    const currency = exchange.default_currency || 'KRW';
    const utcOffset = exchange.default_UTC_offset || 9;
    const ma = url.searchParams.get("ma")?.split(",").map(v => parseInt(v)).filter(v => !isNaN(v)) ?? [];

    return {
        symbol: symbol,
        interval: interval,
        currency: currency,
        utcOffset: utcOffset,
        ma
    }
}