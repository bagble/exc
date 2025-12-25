import {redirect} from "@sveltejs/kit";


export async function load({ parent, url }) {
    const { userId } = await parent();

    if (url.pathname === '/auth/logout') { // /auth/logout 경로일 경우 무시
        return {};
    }

    if (userId) { // 이미 로그인된 상태라면 홈으로 리다이렉트
        throw redirect(302, '/');
    }

    return {};
}