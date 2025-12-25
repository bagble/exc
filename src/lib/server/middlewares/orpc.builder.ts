import type { InferSelectModel } from "drizzle-orm";
import type { users } from "$lib/server/postgresql/schemas";
import { onError, ORPCError, os, ValidationError } from "@orpc/server";
import { z } from "zod";
import type { Cookies } from "@sveltejs/kit";

export type ContextType = {
    source?: 'server' | 'client';
    key?: string;
    ip: string;
    userAgent: string;
    timestamp?: number; // [자동으로 설정됨]
    endpoint: string;
    deviceId?: string; // 선택적 디바이스 ID
    sessionId?: string; // 선택적 세션 ID
    data?: any; // 선택적 추가 데이터
    expiresAt?: number; // 만료 시간 (밀리초) [자동으로 설정됨]
    signature?: string;
    user?: InferSelectModel<typeof users>; // 인증된 사용자 정보 (비밀번호 제외)
    cookies?: Cookies; // 쿠키 객체
}

/**
 * ORPC 미들웨어 설정용 빌더
 * - 입력 검증 에러 핸들링
 */
export const middlewareBuilder = os.$context<ContextType>().errors({
    UNAUTHORIZED: {
        status: 401,
        data: z.object({
            reason: z.string().optional()
        }).optional()
    },
    FORBIDDEN: {
        status: 403,
        data: z.object({
            requiredRole: z.string().optional()
        }).optional()
    },
    CONFLICT: {
        status: 409,
        data: z.object({
            field: z.string().optional(),
            value: z.string().optional(),
            reason: z.string().optional()
        }).optional()
    },
    BAD_REQUEST: {
        status: 400,
        data: z.object({
            field: z.string().optional(),
            value: z.string().optional(),
            reason: z.string().optional()
        }).optional()
    },
    NOT_FOUND: {
        status: 404,
        data: z.object({
            field: z.string().optional(),
            value: z.string().optional()
        }).optional()
    },
    TOO_MANY_REQUESTS: {
        status: 429,
        data: z.object({
            limit: z.number().optional(),
            current: z.number().optional(),
            retryAfter: z.number().optional()
        }).optional()
    },
    INTERNAL_SERVER_ERROR: {
        status: 500,
        data: z.object({
            reason: z.string().optional()
        }).optional()
    }
})

/**
 * ORPC 빌더
 * - 공통 미들웨어 적용
 * - 입력 검증 에러 핸들링
 */
export const rpcBuilder = middlewareBuilder.use(onError((error) => {
    if (
        error instanceof ORPCError &&
        error.code === 'BAD_REQUEST' &&
        error.cause instanceof ValidationError
    ) {
        const zodError = new z.ZodError(error.cause.issues as z.core.$ZodIssue[]);

        throw new ORPCError('INPUT_VALIDATION_FAILED', {
            status: 422,
            message: z.prettifyError(zodError),
            data: z.flattenError(zodError),
            cause: error.cause,
        });
    }
}));