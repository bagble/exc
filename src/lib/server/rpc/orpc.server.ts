import { createRouterClient } from '@orpc/server'
import { privateRouter } from '$lib/server/rpc/router'
import { env } from '$env/dynamic/private'
import { createSecureContext } from "$lib/server/HMAC";

interface ContextData {
    ip: string;
    userAgent: string;
    endpoint: string;
    deviceId?: string; // 선택적 디바이스 ID
    sessionId?: string; // 선택적 세션 ID
    data?: any; // 선택적 추가 데이터
}

/**
 * 서버 내부에서 ORPC 클라이언트를 생성합니다.
 * @param context - 추가 컨텍스트 데이터 (선택 사항)
 * @returns ORPC 요청 결과
 */
export function getServerORPC(context?: any) {
    return createRouterClient(privateRouter, {
        context: async () => {
            return {
                source: 'server',
                key: env.SERVER_KEY,
                ...context,
            }
        }
    })
}

/**
 * 서버에서 클라이언트처럼 ORPC 클라이언트를 생성합니다.
 * @param context - 클라이언트와 유사한 컨텍스트 데이터
 * @returns ORPC 요청 결과
 */
export function getClientORPC(context: ContextData) {
    const signature = createSecureContext({
        source: 'client',
        ...context,
    })

    return createRouterClient(privateRouter, {
        context: async () => {
            return {
                ...signature
            }
        }
    })
}