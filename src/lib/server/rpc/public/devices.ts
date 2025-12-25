import { rateLimitORPCMiddleware, signatureRequiredORPCMiddleware } from "$lib/server/middlewares/orpc.auth.middleware";
import { z } from "zod";
import { redis } from "$lib/server/redis/db";
import crypto from 'crypto';
import { rpcBuilder } from "$lib/server/middlewares/orpc.builder";

/**
 * 요청한 기기가 유효한지 확인합니다.
 * - device_id 쿠키가 존재하는지 확인합니다.
 * - Redis에 해당 device_id가 존재하는지 확인합니다.
 * - device_id의 남은 TTL이 3일 이하인 경우, TTL을 7일로 갱신합니다.
 * - 주의사항: DeviceID는 사용자를 식별하는 용도가 아니라, 단순히 기기의 유효성을 확인하는 용도로만 사용됩니다. 따라서, 사용자를 식별하는 데 사용해서는 안 됩니다.
 * @returns `{ validDevice: boolean }` - 기기가 유효한지 여부
 */
export const checkDevice = rpcBuilder
    .use(signatureRequiredORPCMiddleware)
    .handler(async ({context}) => {
        const DEVICE_TTL_THRESHOLD = 60 * 60 * 24 * 3; // 3일
        const DEVICE_TTL_RENEWAL = 60 * 60 * 24 * 7;   // 7일

        const deviceId = context.cookies?.get('device_id');

        const expire_time = deviceId && await redis.ttl(`device:${deviceId}`) || -2;

        if (expire_time > 0 && expire_time <= DEVICE_TTL_THRESHOLD) { // 키가 존재하고, 만료 시간이 임계값 이하인 경우 갱신
            await redis.expire(`device:${deviceId}`, DEVICE_TTL_RENEWAL);

            context.cookies?.set('device_id', deviceId!, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict',
                maxAge: DEVICE_TTL_RENEWAL,
                path: '/'
            });
        }

        return {
            validDevice: expire_time ? expire_time > 0 : false
        };
    });

/**
 * 요청한 기기를 등록합니다.
 * - fingerprint, IP, User-Agent를 조합하여 device_id를 생성합니다.
 * - device_id를 device_id 쿠키에 저장합니다.
 * - Redis에 device_id와 기기 정보를 저장합니다.
 * - Rate Limit: 10분에 10회
 * @param fingerprint - 클라이언트에서 생성한 기기 지문
 * @returns `{ success: boolean }` - 등록 성공 여부
 */
export const registerDevice = rpcBuilder
    .use(rateLimitORPCMiddleware(10, 600)) // 10분에 10회
    .use(signatureRequiredORPCMiddleware)
    .input(z.object({
        fingerprint: z.string()
    }))
    .handler(async ({context, input}) => {
        const DEVICE_TTL_GENERAL = 60 * 60 * 24 * 7; // 7일

        const ip = context.ip;
        const userAgent = context.userAgent;
        const {fingerprint} = input;

        const deviceId = "PJS2_" + crypto
            .createHash('sha256')
            .update(fingerprint + ip + userAgent)
            .digest('hex')
            .slice(0, 32);

        context.cookies?.set('device_id', deviceId, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: DEVICE_TTL_GENERAL, // GENERAL 기간 동안 유지 (서버 접속할때 마다 갱신됨)
            path: '/'
        });

        await redis.set(
            `device:${deviceId}`,
            JSON.stringify({
                fingerprint,
                ip,
                userAgent,
                createdAt: Date.now()
            }), 'EX', DEVICE_TTL_GENERAL // GENERAL 기간 동안 유지
        );

        return {success: true};
    });