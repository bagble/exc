import {redirect} from "@sveltejs/kit";
import type {PJSe} from "$lib/server/loader/loader";
import {logger} from "../../../utils/logger";
import {env} from "$env/dynamic/private";

export async function load({ parent, cookies, getClientAddress, request }) {
    const exchange = (globalThis as any).exchange as PJSe;
    const { user, userId } = await parent();
    const ip = env.CLOUDFLARED_TUNNEL ? request.headers.get('CF-Connecting-IP') || getClientAddress() : getClientAddress();

    if (!user?.admin || !user?.active) { // 관리자가 아니거나 비활성화된 계정인 경우 접근 불가
        logger.warn(`Forbidden access attempt to admin page by user ID: ${userId}, IP: ${ip} and Device ID: ${cookies.get('device_id')}`);
        throw redirect(303, "/");
    }

    logger.info(`Admin page accessed by user ID: ${userId}, IP: ${ip} and Device ID: ${cookies.get('device_id')}`);
    return { exchange, user: user };
}