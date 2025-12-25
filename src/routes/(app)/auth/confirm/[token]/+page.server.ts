import type {PageServerLoad} from "./$types";
import {getServerORPC} from "$lib/server/rpc/orpc.server";
import { redirect } from "@sveltejs/kit";
import { logger } from "../../../../../utils/logger";

export const load: PageServerLoad = async ({ params }) => {
    const { token } = params;

    try {
        await getServerORPC().users.verifyEmail({
            token
        });
    } catch (error) {
        logger.error(`Email verification failed for token: ${token}, error: ${error}`);
        throw redirect(303, '/auth?verified=false');
    }

    logger.info(`Email verified successfully for token: ${token}`);
    throw redirect(303, '/auth?verified=true');
}