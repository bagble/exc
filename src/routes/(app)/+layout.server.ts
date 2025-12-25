import {redirect} from "@sveltejs/kit";
import {redis} from "$lib/server/redis/db";
import {getServerORPC} from "$lib/server/rpc/orpc.server";
import {logger} from "../../utils/logger";
import { env } from "$env/dynamic/private";

export async function load(event) {
    const { cookies, url } = event;
    const ip = env.CLOUDFLARED_TUNNEL ? event.request.headers.get('CF-Connecting-IP') || event.getClientAddress() : event.getClientAddress();

    if (url.pathname.startsWith("/auth/logout")) { // /auth/logout 경로일 경우 무시
        return { validDevice: true, userId: null, user: null };
    }

    const device_id = cookies.get("device_id");
    const session = cookies.get("session_id");
    if (!device_id && session) { // 디바이스 아이디가 없는데 세션이 있는 경우 (비정상적인 상황)
        logger.warn(`Session without device_id detected. Forcing logout. IP: ${ip}`);
        throw redirect(303, "/auth/logout?silent=true");
    }

    if (!session) { // 세션이 없는 경우 (비 로그인 상태)
        const response = await getServerORPC({ cookies }).devices.check(); // 세션이 없는 경우 디바이스 아이디만 따로 검증
        return { validDevice: response.validDevice, userId: null, user: null };
    }

    const data = await redis.get(`session:${session}`);
    if (!data) { // 세션이 존재하지 않는 경우 (만료되었거나 잘못된 세션)
        logger.warn(`Invalid session detected. Forcing logout. IP: ${ip}`);
        throw redirect(303, "/auth/logout?silent=true");
    }

    let sessionJson;
    try {
        sessionJson = JSON.parse(data);
    } catch (e) { // 세션 데이터가 올바르지 않은 경우 강제 로그아웃 처리
        logger.error(`Error parsing session data: ${e}. Forcing logout. IP: ${ip}`);
        throw redirect(303, "/auth/logout?silent=true");
    }

    const userId = sessionJson.userId;
    const deviceId = sessionJson.deviceId;

    if (!userId || deviceId !== device_id) { // 세션에 등록된 device id가 일치해야함 (탈취 방지)
        logger.warn(`Device ID mismatch detected for user ID: ${userId}. Forcing logout. IP: ${ip}`);
        throw redirect(303, "/auth/logout?silent=true");
    }

    // 세션이 존재하고 정상적인 경우 사용자 정보와 함께 데이터 반환
    const user = await getServerORPC().users.get({ id: userId });
    if (!user || !user.active) { // 사용자가 존재하지 않거나 비활성화된 경우 강제 로그아웃 처리
        logger.warn(`Inactive or non-existent user detected for user ID: ${userId}. Forcing logout. IP: ${ip}`);
        throw redirect(303, "/auth/logout?silent=true");
    }

    return { validDevice: true, userId: userId, user: user  };
}