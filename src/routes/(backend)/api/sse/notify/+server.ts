import { produce } from 'sveltekit-sse';
import { logger } from "../../../../../utils/logger";
import { addNotifyClient, removeNotifyClient } from "$lib/server/sse";
import { redis } from "$lib/server/redis/db";
import { getOrderNotify } from "$lib/server/redis/presets/notify";
import { env } from "$env/dynamic/private";

export function GET({request, cookies, getClientAddress}) {
    return produce(
        async function start({emit}) {
            const sessionId = crypto.randomUUID();
            const ip = env.CLOUDFLARED_TUNNEL ? request.headers.get('CF-Connecting-IP') || getClientAddress() : getClientAddress();
            if (!sessionId) {
                return function stop() {
                    logger.error('Notify: Missing session-id header.');
                };
            }

            const sessionIdCookie = cookies.get("session_id");
            const deviceIdCookie = cookies.get("device_id");

            if (!sessionIdCookie || !deviceIdCookie) {
                logger.warn(`Notify: Missing session or device ID cookie. sessionId: ${sessionId} IP: ${ip}`);
                return function stop() {
                    logger.error(`Notify: SSE connection stopped due to missing cookies. sessionId: ${sessionId} IP: ${ip}`);
                };
            }

            const sessionData = await redis.get(`session:${sessionIdCookie}`)
            if (!sessionData) {
                logger.warn(`Notify: Invalid session data in Redis. sessionId: ${sessionId}`);
                return function stop() {
                    logger.warn(`Notify: SSE connection stopped due to invalid session. sessionId: ${sessionId} IP: ${ip}`);
                };
            }

            const parsedSession = JSON.parse(sessionData);
            if (!parsedSession || parsedSession.deviceId !== deviceIdCookie) {
                return function stop() {
                    logger.error(`Notify: SSE connection stopped due to session/device ID mismatch. sessionId: ${sessionId} IP: ${ip}`);
                };
            }

            const userId = parsedSession.userId;

            try {
                addNotifyClient(userId, {emit, sessionID: sessionId});

                // 초기 연결 시 메시지 전송
                emit('connected', JSON.stringify({
                    message: 'Connected to SSE',
                    sessionId
                }));

                const orderNotify = await getOrderNotify(userId, 100); // 최근 100개 알림 데이터 가져오기
                emit('order', JSON.stringify({
                    type: "init",
                    notify: orderNotify ?? []
                }));

                logger.info(`Notify: Client connected: ${sessionId} for userId: ${userId}`);

                return function cleanup() {
                    // 클라이언트 연결 해제 시 정리
                    removeNotifyClient(userId, {emit, sessionID: sessionId});
                    logger.info(`Notify: Client disconnected: ${sessionId} for userId: ${userId}`);
                };
            } catch (e) {
                logger.error(`Notify: SSE connection error: ${e}`);
                return function stop() {
                    logger.error(`Notify: SSE connection cleanup after error: ${sessionId} for userId: ${userId}`)
                };
            }
        },
        {
            ping: 30000, // send a ping every 30 seconds
            stop() {
                logger.info('Notify: SSE connection stopped by the server.');
            }
        }
    );
}