import { type EXC } from "./loader";
import { clearAllCaches } from "$lib/server/redis/presets/global";
import { logger } from "../../../utils/logger";

export let session = {"session": "closed"}; // "pre" | "regular" | "post" | "closed"
let cacheCleared = false; // 캐시 초기화 여부를 추적하는 변수

/**
 * 세션을 업데이트하는 함수
 * - 현재 시간을 기준으로 세션을 "pre", "regular", "post", "closed"로 설정
 * - 세션이 "closed"일 때 Redis 캐시를 초기화
 */
export function updateSession() {
    const exchange = (globalThis as any).exchange as EXC;
    const offset = (exchange.default_UTC_offset || 0) * 60 * 60 * 1000;

    const now = Date.now() + offset;
    const date = new Date(now).toISOString().slice(0, 10); // "YYYY-MM-DD"
    const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
    const weekday = weekdays[new Date(now).getUTCDay()]; // 0~6 -> "Sunday"~"Saturday"
    const currentTime = new Date(now).toISOString().slice(11, 16); // "HH:MM"

    let anniversary = {}
    if (exchange.anniversaries) { // 오늘이 기념일인지 확인
        for (let i = 0; i < exchange.anniversaries.length; i++) {
            if (exchange.anniversaries[i].date === date) {
                anniversary = exchange.anniversaries[i];
                break;
            }
        }
    }

    let pre;
    let regular;
    let post;
    if (anniversary && (anniversary as any).regular_trading_session) { // 기념일 세션이 정의되어 있는 경우
        pre = (anniversary as any).pre_market_session || {};
        regular = (anniversary as any).regular_trading_session || {};
        post = (anniversary as any).post_market_session || {};
    } else {
        pre = exchange.pre_market_sessions[weekday] || {};
        regular = exchange.regular_trading_sessions[weekday] || {};
        post = exchange.post_market_sessions[weekday] || {};
    }

    if (pre && (pre as any).open && (pre as any).close) {
        const preOpenTime = new Date(`1970-01-01T${(pre as any).open}:00`);
        const preCloseTime = new Date(`1970-01-01T${(pre as any).close}:00`);
        const currentDateTime = new Date(`1970-01-01T${currentTime}:00`);

        if (preCloseTime < preOpenTime) {
            if (currentDateTime >= preOpenTime || currentDateTime < preCloseTime) {
                session.session = "pre";
                cacheCleared = false; // 캐시 초기화 상태 리셋
                return;
            }
        } else {
            if (currentDateTime >= preOpenTime && currentDateTime < preCloseTime) {
                session.session = "pre";
                cacheCleared = false; // 캐시 초기화 상태 리셋
                return;
            }
        }
    }
    if (regular && (regular as any).open && (regular as any).close) {
        const regularOpenTime = new Date(`1970-01-01T${(regular as any).open}:00`);
        const regularCloseTime = new Date(`1970-01-01T${(regular as any).close}:00`);
        const currentDateTime = new Date(`1970-01-01T${currentTime}:00`);

        if (regularCloseTime < regularOpenTime) {
            if (currentDateTime >= regularOpenTime || currentDateTime < regularCloseTime) {
                session.session = "regular";
                cacheCleared = false; // 캐시 초기화 상태 리셋
                return;
            }
        } else {
            if (currentDateTime >= regularOpenTime && currentDateTime < regularCloseTime) {
                session.session = "regular";
                cacheCleared = false; // 캐시 초기화 상태 리셋
                return;
            }
        }
    }
    if (post && (post as any).open && (post as any).close) {
        const postOpenTime = new Date(`1970-01-01T${(post as any).open}:00`);
        const postCloseTime = new Date(`1970-01-01T${(post as any).close}:00`);
        const currentDateTime = new Date(`1970-01-01T${currentTime}:00`);

        if (postCloseTime < postOpenTime) {
            if (currentDateTime >= postOpenTime || currentDateTime < postCloseTime) {
                session.session = "post";
                cacheCleared = false; // 캐시 초기화 상태 리셋
                return;
            }
        } else {
            if (currentDateTime >= postOpenTime && currentDateTime < postCloseTime) {
                session.session = "post";
                cacheCleared = false; // 캐시 초기화 상태 리셋
                return;
            }
        }
    }

    session.session = "closed";
    if (!cacheCleared) clearCache(); // 세션이 "closed"일 때 캐시 초기화
}

/**
 * Redis 캐시를 초기화하는 함수
 * - 세션이 "closed"일 때 호출되어 모든 캐시를 삭제
 * - 30분 후에 다시 시도하여 안정성을 확보
 */
function clearCache() {
    cacheCleared = true; // 캐시 초기화 상태로 설정

    setTimeout(() => {
        (async () => {
            const result = await clearAllCaches();

            if (!result.error) {
                logger.info(`[PJSe] All caches cleared successfully during closed session.`);
            } else {
                logger.error(`[PJSe] Error clearing caches during closed session: ${result.message}`, result.error);
            }
        })();
    }, 1800000); // 30분 대기 후 실행
}