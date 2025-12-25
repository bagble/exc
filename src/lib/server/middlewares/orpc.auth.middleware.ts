import { env } from "$env/dynamic/private";
import { redis } from "$lib/server/redis/db";
import { orm } from "$lib/server/postgresql/drizzle";
import { verifyContextSignature } from "$lib/server/HMAC";
import { logger } from "../../../utils/logger";
import { middlewareBuilder } from "$lib/server/middlewares/orpc.builder";

/**
 * 서버에서 보내는 요청만 허용하는 미들웨어
 * - 서버 키가 올바른지 확인
 * - 클라이언트 요청은 모두 거부
 */
export const serverOnlyORPCMiddleware = middlewareBuilder.middleware(async ({context, next, errors}) => {
    if (context.source === "server" && context.key === env.SERVER_KEY) { // 서버에서 보내는 요청인지 확인
        return next({context});
    }

    throw errors.UNAUTHORIZED({
        message: 'Authentication required',
        data: {reason: 'no_auth'}
    }); // 안전을 위해 자세한 정보는 제공하지 않음
});

/**
 * 관리자 권한이 있는 사용자만 허용하는 미들웨어
 * - 서버 요청은 서버 키로 인증 (허용)
 * - 클라이언트 요청은 서명 검증 후 세션의 사용자 정보 조회 -> 관리자인지 확인
 * - context에 user 정보 추가
 */
export const adminOnlyORPCMiddleware = middlewareBuilder.middleware(async ({context, next, errors}) => {
    if (context.source === "server" && context.key === env.SERVER_KEY) { // 서버에서 보내는 요청인지 확인
        return next({context});
    }

    return await verifyORPCSignature(context, errors, async () => { // 서명 검증 && 클라이언트에서 보내는 요청인지 확인
        const user = await getUserCache(context, errors);

        if (user.admin) { // 관리자인지 확인
            return next({
                context: {
                    ...context,
                    user: {
                        ...user
                    }
                }
            });
        }

        throw errors.FORBIDDEN({
            message: 'Admin access required',
            data: {requiredRole: 'admin'}
        });
    });
});

/**
 * 로그인된 사용자만 접근 허용하는 미들웨어
 * - 서버 요청은 서버 키로 인증 (허용)
 * - 클라이언트 요청은 서명 검증 후 세션의 사용자 정보 조회 -> 활성화된 사용자(active)인지 확인
 * - context에 user 정보 추가
 */
export const authOnlyORPCMiddleware = middlewareBuilder.middleware(async ({context, next, errors}) => {
    if (context.source === "server" && context.key === env.SERVER_KEY) { // 서버에서 보내는 요청인지 확인
        return next({context}); // (반드시 context에 user를 직접 넣어줘야 함)
    }

    return await verifyORPCSignature(context, errors, async () => { // 서명 검증 && 클라이언트에서 보내는 요청인지 확인
        const user = await getUserCache(context, errors);
        return next({
            context: {
                ...context,
                user: {
                    ...user
                }
            }
        });
    });
});

/**
 * 인증된 기기에서만 접근 허용하는 미들웨어
 * - 서버 요청은 서버 키로 인증 (허용)
 * - 클라이언트 요청은 서명 검증 후 deviceId가 존재하는지 확인 -> Redis에 해당 deviceId가 존재하는지 확인
 * - 주의사항: 디바이스ID는 클라이언트에서 위.변조하여 보낼수 있으므로 신뢰가 불가능합니다. 따라서, 중요한 작업을 할 때는 이 미들웨어 대신 {@link authOnlyORPCMiddleware}, {@link adminOnlyORPCMiddleware} 등을 사용하여 반드시 사용자 인증을 하시기 바랍니다.
 */
export const verifiedDeviceOnlyORPCMiddleware = middlewareBuilder.middleware(async ({context, next, errors}) => {
    if (context.source === "server" && context.key === env.SERVER_KEY) { //
        return next({context});
    }

    return await verifyORPCSignature(context, errors, async () => { // 서명 검증 && 클라이언트에서 보내는 요청인지 확인
        if (!context.deviceId) {
            throw errors.UNAUTHORIZED({
                message: 'Device ID required',
                data: {reason: 'no_device_id'}
            });
        }

        const device = await redis.get(`device:${context.deviceId}`);
        if (device) {
            return next({context});
        }

        throw errors.UNAUTHORIZED({
            message: 'Unverified device',
            data: {reason: 'unverified_device'}
        });
    });
});

/**
 * 요청 횟수 제한 미들웨어 (특정 시간 내에 최대 limit회 요청 허용)
 * - 서버 요청은 Rate Limit 적용 안 함 (허용)
 * - 식별자는 userId, 혹은 IP 사용 (env 설정에 따라 관리자 유저 ID, IP는 제한 없음)
 * - 주의사항: userId를 식별자로 사용할 때는 반드시 authOnlyORPCMiddleware 또는 adminOnlyORPCMiddleware 이후에 적용해야 합니다.
 * @param limit 최대 요청 횟수
 * @param interval 인터벌 (초)
 * @param suffix 키 접미사 (기본값: 빈 문자열, endpoint 대신 고정된 키로 제한할 때 사용)
 * @param userId 식별자로 userId 사용 여부 (기본값: false, true면 userId 우선, 없으면 IP 사용)
 */
export const rateLimitORPCMiddleware = (limit: number, interval: number, suffix: string = "", userId: boolean = false) => middlewareBuilder.middleware(async ({
                                                                                                                                                           context,
                                                                                                                                                           next,
                                                                                                                                                           errors
                                                                                                                                                       }) => {
    if (context.source === "server" && context.key === env.SERVER_KEY) { // 서버에서 보내는 요청인지 확인
        return next({context});
    }

    return await verifyORPCSignature(context, errors, async () => { // 서명 검증 && 클라이언트에서 보내는 요청인지 확인
        const identifier = userId ? context.user?.id.toString() || context.ip : context.ip;
        if (!identifier) {
            throw errors.UNAUTHORIZED({
                message: 'Authentication required',
                data: {reason: 'no_identifier'}
            });
        }

        const bypassIdentifiers = [
            "127.0.0.1",
            "::1",
            "localhost",
            ...(env.RATELIMIT_BYPASS_IPS ? env.RATELIMIT_BYPASS_IPS.split(',') : []),
            ...(env.RATELIMIT_BYPASS_USERIDS ? env.RATELIMIT_BYPASS_USERIDS.split(',') : []),
            ...(env.RATELIMIT_BYPASS_DEVICEIDS ? env.RATELIMIT_BYPASS_DEVICEIDS.split(',') : []),
        ]
        if (bypassIdentifiers.includes(identifier)) { // 관리자 디바이스 ID 또는 로컬호스트는 제한 없음
            return next({context});
        }

        let key = `rate_limit:${identifier}:${context.endpoint}`;
        if (suffix !== "") {
            key = `rate_limit:${identifier}:${suffix}`;
        }

        try {
            // language=Lua
            const script = `
                local limit = tonumber(ARGV[1]) -- 인터벌 내 허용 횟수
                local interval = tonumber(ARGV[2]) -- 인터벌 (초)
                local identifier = ARGV[3] -- 식별자
                local key = KEYS[1] -- Redis 키

                local time = redis.call('TIME')
                local now = time[1] * 1000 + math.floor(time[2] / 1000)
                
                local windowStart = now - (interval * 1000)
                redis.call('ZREMRANGEBYSCORE', key, 0, windowStart) -- 오래된 항목 제거
                local currentCount = redis.call('ZCARD', key)
                
                if currentCount >= limit then
                    local earliest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')[2]
                    local retryAfter = math.ceil((earliest + (interval * 1000) - now) / 1000) -- 초 단위로 변환
                    return {0, retryAfter} -- 제한 초과 응답 및 재시도 시간
                end
                
                redis.call('ZADD', key, now, identifier .. ':' .. now) -- 현재 요청 추가
                redis.call('PEXPIRE', key, interval * 1000) -- 키 만료 시간 설정
                return {1, -1} -- 성공 응답
            `;

            const result = await redis.eval(script, 1, key, limit.toString(), interval.toString(), identifier) as [number, number];
            const allowed = result[0] === 1;
            const retryAfter = result[1];

            if (!allowed) {
                logger.warn(`Rate limit exceeded for identifier: ${identifier}, global: ${global}, endpoint: ${context.endpoint}, limit: ${limit}, interval: ${interval}s`);
                throw errors.TOO_MANY_REQUESTS({
                    message: 'Rate limit exceeded',
                    data: {limit, retryAfter: retryAfter > 0 ? retryAfter : -1}
                });
            }

        } catch (error) {
            logger.error(`Rate limiting failed for identifier: ${identifier}, endpoint: ${context.endpoint} - ${error}`);
            throw errors.INTERNAL_SERVER_ERROR({
                message: 'Rate limiting failed',
                data: {reason: 'rate_limit_error'}
            });
        }

        return next({context});
    });
});

/**
 * 서명된 요청만 허용하는 미들웨어
 * - 서버 요청은 서버 키로 인증 (허용)
 * - context 서명을 검증후 허용
 */
export const signatureRequiredORPCMiddleware = middlewareBuilder.middleware(async ({context, next, errors}) => {
    if (context.source === "server" && context.key === env.SERVER_KEY) { // 서버에서 보내는 요청인지 확인
        return next({context});
    }

    return await verifyORPCSignature(context, errors, async () => { // 서명 검증 && 클라이언트에서 보내는 요청인지 확인
        return next({context});
    });
});

async function verifyORPCSignature(context: any, errors: any, callback: () => Promise<any>) {
    if (context.source === "client" && context.signature) { // 클라이언트에서 보내는 요청인지 확인
        const signCheck = verifyContextSignature({
            ip: context.ip,
            userAgent: context.userAgent,
            timestamp: context.timestamp,
            endpoint: context.endpoint,
            deviceId: context.deviceId,
            sessionId: context.sessionId,
            data: context.data,
            expiresAt: context.expiresAt
        }, context.signature);
        if (!signCheck) {
            logger.warn(`Abnormal API request detected. endpoint: ${context.endpoint}, deviceId: ${context?.deviceId}, sessionId: ${context?.sessionId}, ip: ${context.ip}`);
            throw errors.UNAUTHORIZED({
                message: 'Invalid API request',
                data: {reason: 'invalid_api_request'}
            });
        }
    }

    return await callback();
}

async function getUserCache(context: any, errors: any) { // 주의: 유저는 기본적으로 활성화 상태인지만 검증합니다. 권한 검증은 따로 해야 합니다.
    const session = await redis.get(`session:${context.sessionId}`);
    const sessionJson = session ? JSON.parse(session) : null;
    const sessionDeviceId = sessionJson ? sessionJson.deviceId : null;
    const sessionUserId = sessionJson ? sessionJson.userId : null;
    if (session && context.deviceId !== sessionDeviceId && sessionUserId) { // 세션의 deviceId와 요청의 deviceId가 일치하는지 확인
        throw errors.UNAUTHORIZED({
            message: 'Device ID does not match session',
            data: {reason: 'device_id_mismatch'}
        });
    }

    // Redis에서 사용자 정보 조회
    const userCache = await redis.get(`user:${sessionUserId}`);
    if (userCache) {
        const user = JSON.parse(userCache)

        if (!user.active) { // 활성화된 사용자 인지 확인
            throw errors.FORBIDDEN({
                message: 'Active user access required',
                data: {requiredRole: 'active_user'}
            });
        }

        return user;
    }

    // Redis에 캐시된 정보가 없으면 데이터베이스에서 조회
    const user = await orm.query.users.findFirst({
        where: (users, {eq}) => eq(users.id, sessionUserId),
        columns: {password: false} // 비밀번호 제외
    });

    if (!user || !user.active) { // 유저가 존재하는지, 활성화된 사용자 인지 확인
        throw errors.FORBIDDEN({
            message: 'Active user access required',
            data: {requiredRole: 'active_user'}
        });
    }

    await redis.set(`user:${sessionUserId}`, JSON.stringify({
        ...user,
    }), 'EX', 3600); // 1시간 캐시

    return user;
}