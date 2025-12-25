import type { Handle, ServerInit } from '@sveltejs/kit';
import { paraglideMiddleware } from '$lib/paraglide/server';
import { initPostgres } from "$lib/server/postgresql/db";
import { initRedis } from "$lib/server/redis/db";
import { sequence } from "@sveltejs/kit/hooks";
import { Cron } from "croner";
import { loader } from "$lib/server/loader/loader";
import { session, updateSession } from "$lib/server/loader/EXC";
import { logger } from "./utils/logger";
import { broadcastToDataClients, getDataClients } from "$lib/server/sse";
import { updateSessionTime } from "$lib/server/redis/time";

export const ALLOWED_ORIGINS = [
    process.env.ORIGIN || 'http://localhost:5173', // 운영 환경, 개발 환경
];

let newLoad = false;
const tasks: any[] = [];

export const init: ServerInit = async () => {
    (globalThis as any).exchange = loader.get();

    loader.onChange((newConfig) => { // 거래소 데이터가 변경될 때마다 호출되는 콜백 등록
        (globalThis as any).exchange = newConfig;
    });

    await initPostgres();
    await initRedis();

    if (!newLoad) {
        newLoad = true;
        updateSession(); // 서버 시작 시 세션 정보 초기화
        if (session.session !== "closed") updateSessionTime(session.session as "pre" | "regular" | "post" | "closed");

        let isJobRunning = false;

        tasks.push(new Cron('0 * * * * *', async () => {
            if (isJobRunning) {
                logger.warn('이전 세션 업데이트가 아직 진행 중입니다. 이번 실행을 건너뜁니다.');
                return;
            }

            isJobRunning = true;
            try {
                const oldSession = session.session;
                updateSession();
                if (oldSession !== session.session) {
                    updateSessionTime(session.session as "pre" | "regular" | "post" | "closed");

                    for (let symbol in getDataClients()) {
                        broadcastToDataClients(symbol, 'session', JSON.stringify(session), {session: true}).catch((err) => {
                            logger.error('SSE 브로드캐스트 오류:', err);
                        });
                    }
                    logger.info(`세션 업데이트 완료! | 세션: ${session.session}`);
                }
            } catch (error) {
                logger.error('세션 업데이트 작업 중 오류 발생:', error);
            } finally {
                isJobRunning = false;
            }
        }));

        process.on('SIGTERM', gracefulShutdown);
        process.on('SIGINT', gracefulShutdown);

        function gracefulShutdown(signal: any) {
            logger.info(`${signal} 신호 수신 - 종료 시작`);

            tasks.forEach(task => {
                task.stop();
            });

            const timeout = setTimeout(() => {
                logger.warn('종료 타임아웃 - 강제 종료');
                process.exit(1);
            }, 30000);

            if (!isJobRunning) {
                clearTimeout(timeout);
                logger.info('Graceful shutdown 완료');
                process.exit(0);
            }
        }
    }
}

const handleParaglide: Handle = ({event, resolve}) => paraglideMiddleware(event.request, ({request, locale}) => {
    event.request = request;

    return resolve(event, {
        transformPageChunk: ({html}) => html.replace('%paraglide.lang%', locale)
    });
});

export const handleCORS = sequence(
    async ({event, resolve}) => {
        const origin = event.request.headers.get('origin')!;

        if (event.url.pathname.startsWith('/api')) {
            if (event.request.method === 'OPTIONS') {
                return new Response(null, {
                    headers: {
                        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                        'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : '',
                        'Access-Control-Allow-Headers': '*',
                        'Access-Control-Max-Age': '86400',
                    }
                });
            }
        }

        const response = await resolve(event);

        if (event.url.pathname.startsWith('/api') && ALLOWED_ORIGINS.includes(origin)) {
            response.headers.append('Access-Control-Allow-Origin', origin);
            response.headers.append('Access-Control-Allow-Credentials', 'true');
        }

        return response;
    }
);

export const handle: Handle = sequence(
    handleCORS,
    handleParaglide,
    // 다른 미들웨어들 추가 (예: 인증, 로깅 등)
);
