import {browser} from "$app/environment";
import {safe} from "@orpc/client";
import {rpc} from "$lib/client/rpc";

/**
 * 디바이스 지문 생성
 * 디바이스 지문을 생성할때 사용되는 정보:
 * - User Agent
 * - 언어 설정
 * - 화면 해상도
 * - 타임존 오프셋
 * - Canvas 데이터
 * - 색상 깊이
 * - 플랫폼 정보
 * @returns {string | null} Base64로 인코딩된 디바이스 지문 문자열 또는 null
 */
export function generateDeviceFingerprint(): string | null {
    if (!browser) return null;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillText('Device fingerprint', 2, 2);

    const fingerprint = {
        userAgent: navigator.userAgent,
        language: navigator.language,
        screen: screen.width + 'x' + screen.height,
        timezone: new Date().getTimezoneOffset(),
        canvas: canvas.toDataURL(),
        colorDepth: screen.colorDepth,
        platform: navigator.platform
    };

    return btoa(JSON.stringify(fingerprint)) || null;
}

/**
 * 디바이스 초기화
 * 유효한 디바이스가 아닐 경우, 디바이스 지문을 생성하고 서버에 등록 요청을 보냄
 * @param validDevice - 디바이스가 유효한지 여부
 */
export async function initializeDevice(validDevice: boolean) {
    if (!browser) return;

    if (!validDevice) {
        const fingerprint = generateDeviceFingerprint();

        if (fingerprint) {
            const { error } = await safe(
                rpc.devices.register({ fingerprint })
            );
            if (error) {
                console.error("Device registration failed:", error);
            }
        }
    }
}