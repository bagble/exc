import { timingSafeEqual, createHmac } from 'crypto';
import { env } from '$env/dynamic/private';

const SECRET_KEY = env.SALT;

if (!SECRET_KEY || SECRET_KEY.length < 32) { // 32자 이상이어야 함
    throw new Error('SALT must be at least 32 characters');
}

interface ContextData {
    source?: 'server' | 'client';
    key?: string; // 서버 키 (source가 'server'일 때만 유효)
    ip: string;
    userAgent: string;
    timestamp?: number; // [자동으로 설정됨]
    endpoint: string;
    deviceId?: string; // 선택적 디바이스 ID
    sessionId?: string; // 선택적 세션 ID
    data?: any; // 선택적 추가 데이터
    expiresAt?: number // 만료 시간 (밀리초) [자동으로 설정됨]
}

/**
 * Context 데이터를 HMAC으로 서명합니다.
 * @param data - 서명할 Context 데이터
 * @returns 서명된 HMAC 문자열
 */
export function signContext(data: ContextData): string {
    const payload = JSON.stringify({
        ip: data.ip,
        userAgent: data.userAgent,
        timestamp: data.timestamp,
        endpoint: data.endpoint,
        deviceId: data.deviceId,
        sessionId: data.sessionId,
        data: data.data,
        expiresAt: data.expiresAt
    });
    return createHmac('sha256', SECRET_KEY)
        .update(payload)
        .digest('hex');
}

/**
 * Context 데이터의 서명을 검증합니다.
 * @param data - 검증할 Context 데이터
 * @param signature - 검증할 서명
 * @returns 서명이 유효하면 true, 그렇지 않으면 false
 */
export function verifyContextSignature(data: ContextData, signature: string): boolean {
    if (!signature) return false;

    const expectedSignature = signContext(data);

    if (expectedSignature.length !== signature.length) { // 길이가 다르면 조기 반환
        return false;
    }

    // 상수 시간 비교
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');
    const signatureBuffer = Buffer.from(signature, 'hex');

    const signaturesMatch = timingSafeEqual(expectedBuffer, signatureBuffer);
    const notExpired = data.expiresAt ? Date.now() < data.expiresAt : true;

    return signaturesMatch && notExpired;
}

/**
 * Context 데이터를 생성하고 서명합니다.
 * @param data - 서명할 Context 데이터
 * @returns 서명된 문자열과 원본 Context 데이터
 */
export function createSecureContext(data: ContextData): ContextData & { signature: string } {
    const timestamp = Date.now();
    const contextData: ContextData = {
        ...data,
        timestamp,
        expiresAt: timestamp + (5 * 60 * 1000) // 기본 만료 시간 5분
    };
    const signature = signContext(contextData);

    return {
        ...contextData,
        signature
    };
}