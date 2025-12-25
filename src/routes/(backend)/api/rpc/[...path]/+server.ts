import type { RequestHandler } from './$types'
import { RPCHandler } from '@orpc/server/fetch'
import { publicRouter } from '$lib/server/rpc/router'
import { createSecureContext } from "$lib/server/HMAC";
import { env } from "$env/dynamic/private";

const handler = new RPCHandler(publicRouter)

const handle: RequestHandler = async (event) => {
    const {request, cookies} = event;

    const sign = createSecureContext({
        source: "client",
        ip: env.CLOUDFLARED_TUNNEL ? request.headers.get('CF-Connecting-IP') || event.getClientAddress() : event.getClientAddress(),
        userAgent: request.headers.get('user-agent') || '',
        endpoint: event.url.pathname,
        deviceId: cookies.get('device_id'),
        sessionId: cookies.get('session_id')
    })

    const {response} = await handler.handle(request, {
        prefix: '/api/rpc',
        context: {
            ...sign,
            cookies
        },
    })
    return response ?? new Response(JSON.stringify({error: 'Not Found'}), {
        status: 404,
        headers: {'Content-Type': 'application/json'}
    })
}

export const GET = handle
export const POST = handle
export const PUT = handle
export const PATCH = handle
export const DELETE = handle