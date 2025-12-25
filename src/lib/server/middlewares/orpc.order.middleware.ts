import { middlewareBuilder } from "$lib/server/middlewares/orpc.builder";
import { session } from "../loader/EXC";

/**
 * 거래 가능한 상태인지 확인하는 미들웨어
 * - 세션이 닫힌 경우 주문 생성 불가
 * - 사용자의 레벨이 2 미만인 경우 주문 생성 불가
 */
export const tradableOrderMiddleware = middlewareBuilder.middleware(async ({context, next, errors}) => {
    if (session.session === "closed") { // 세션이 닫힌 경우 주문 생성 불가
        throw errors.FORBIDDEN({
            message: "Session is closed."
        });
    }

    if (!context.user!.emailVerified) { // 이메일 인증이 되지 않은 사용자는 주문 생성 불가
        throw errors.FORBIDDEN({
            message: "Email not verified."
        });
    }

    if (context.user!.level! < 1) { // 레벨이 1 미만인 사용자는 주문 생성 불가
        throw errors.FORBIDDEN({
            message: "User level too low to create orders."
        });
    }

    return next({context});
});