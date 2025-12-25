import type { RouterClient } from '@orpc/server'
import { RPCLink } from '@orpc/client/fetch'
import { createORPCClient } from '@orpc/client'
import { browser } from '$app/environment'
import type { publicRouter } from '$lib/server/rpc/router'

const link = new RPCLink({
    url: () => {
        if (!browser) {
            return 'http://localhost:5173/api/rpc'
        }
        return `${window.location.origin}/api/rpc`
    },
    fetch: (input, init) => fetch(input, {
        ...init,
        keepalive: true,
    }),
})

/**
 * 클라이언트에서 서버의 RPC 엔드포인트에 접근하기 위한 클라이언트 객체입니다. (Public Router 전용)
 * 이 객체를 사용하여 서버의 공개된 RPC 메서드에 안전하게 접근할 수 있습니다.
 */
export const rpc: RouterClient<typeof publicRouter> = createORPCClient(link)