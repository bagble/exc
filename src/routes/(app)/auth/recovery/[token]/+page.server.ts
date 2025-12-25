import type {PageServerLoad} from "./$types";
import {getServerORPC} from "$lib/server/rpc/orpc.server";

export const load: PageServerLoad = async ({ params }) => {
    const { token } = params;

    try {
        await getServerORPC().users.validToken({
            token
        });
    } catch (error) {
        return {
            valid: false,
            token: null
        }
    }

    return {
        valid: true,
        token
    }
}