import { rpcBuilder } from "$lib/server/middlewares/orpc.builder";
import { session } from "../../loader/EXC";

/**
 * 거래소의 현재 세션 정보를 반환합니다.
 * @returns `{ timestamp: number; session: string | null }` - 현재 타임스탬프와 세션 정보
 */
export const nowSession = rpcBuilder
    .handler(async () => {
        return {
            timestamp: Date.now(),
            session: session.session
        };
    });