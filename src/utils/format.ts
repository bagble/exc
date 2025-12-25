import {intervalToMilliseconds} from "./timestamp";

function tzConvert(timestamp: number | string | Date, timezone_offset: number): number {
    const date = new Date(timestamp);
    const utcDate = new Date(date.getTime() + (timezone_offset * 60 * 60 * 1000));
    return utcDate.getTime();
}

function NumberFormatter(value: number, language?: string | string[]): string {
    return new Intl.NumberFormat(language, {
        style: 'decimal',
    }).format(value);
}

function CurrencyFormatter(value: number, language: string | string[], currency: string): string {
    const _currencyFormatter = Intl.NumberFormat(language, { style: 'currency', currency });
    return Intl.NumberFormat(language, {
        style: 'decimal',
        minimumFractionDigits: _currencyFormatter.resolvedOptions().minimumFractionDigits,
        maximumFractionDigits: _currencyFormatter.resolvedOptions().maximumFractionDigits,
    }).format(value);
}

function CurrencyFormatter2(value: number, language: string | string[], currency: string): string {
    return Intl.NumberFormat(language, {
        style: 'currency',
        currency,
        currencyDisplay: 'symbol'
    }).format(value);
}

function TimeFormatter(value: number | Date, language?: string | string[], interval: number = -1): string {

    if (interval !== -1 && interval >= intervalToMilliseconds("1Y")) { // 1 year
        return new Intl.DateTimeFormat(language, { timeZone: 'UTC', year: 'numeric' }).format(value);
    } else if (interval !== -1 && interval >= intervalToMilliseconds("1M")) { // 1 month
        return new Intl.DateTimeFormat(language, { timeZone: 'UTC', year: 'numeric', month: 'long' }).format(value);
    } else if (interval !== -1 && interval >= intervalToMilliseconds("1W")) { // 1 week
        return new Intl.DateTimeFormat(language, { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' }).format(value);
    } else if (interval !== -1 && interval >= intervalToMilliseconds("1D")) { // 1 day
        return new Intl.DateTimeFormat(language, { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' }).format(value);
    }
    return new Intl.DateTimeFormat(language, {
        timeZone: 'UTC',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).format(value);
}

export { tzConvert, TimeFormatter, CurrencyFormatter, CurrencyFormatter2, NumberFormatter };