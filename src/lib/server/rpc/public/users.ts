import { z } from "zod";
import {
    adminOnlyORPCMiddleware,
    authOnlyORPCMiddleware,
    rateLimitORPCMiddleware,
    verifiedDeviceOnlyORPCMiddleware
} from "$lib/server/middlewares/orpc.auth.middleware";
import { orm } from "$lib/server/postgresql/drizzle";
import { users } from "$lib/server/postgresql/schemas";
import { redis } from "$lib/server/redis/db";
import { randomBytes } from "crypto";
import { asc, eq, sql } from "drizzle-orm";
import { env } from "$env/dynamic/private";
import { logger } from "../../../../utils/logger";
import { mailSender } from "$lib/server/email";
import pLimit from "p-limit";
import { escape } from 'lodash-es';
import argon2 from "argon2";
import { rpcBuilder } from "$lib/server/middlewares/orpc.builder";

const limit = pLimit(10); // Email 전송 동시 제한 (너무 많으면 SMTP 서버에서 차단당할 수 있음)

const UserDefaultSchema = z.object({
    id: z.number().min(1).optional(),
    name: z.string().min(1).max(32).regex(/^[a-zA-Z0-9ㄱ-힣_-]+$/, "Name must be alphanumeric, korean, underscore, or hyphen"),
    email: z.email(),
    password: z.string().min(8).max(64),
    createdAt: z.date().default(new Date()),
    updatedAt: z.date().default(new Date()),
    admin: z.boolean().optional().default(false),
    demo: z.boolean().optional().default(false),
    fee: z.number().optional().default(-1),
    active: z.boolean().optional().default(false),
    level: z.number().min(0).max(10).optional().default(0), // 사용자 레벨 (0: 거래 불가, 1: 기본, 2: 프리미엄, 3: VIP ...)
    emailVerified: z.boolean().optional().default(false)
});

const RegisterUserSchema = UserDefaultSchema.pick({
    name: true,
    email: true,
    password: true
})

const LoginUserSchema = UserDefaultSchema.pick({
    email: true,
    password: true
});

const RecoveryPasswordSchema = UserDefaultSchema.pick({
    email: true
});

const UpdateUserSchema = UserDefaultSchema.pick({
    name: true,
    email: true,
    password: true
}).partial();

const GetUserSchema = UserDefaultSchema.pick({
    id: true,
    name: true,
    email: true,
}).partial();

const UpdateUserByIDSchema = UserDefaultSchema.pick({
    id: true,
    name: true,
    email: true,
    admin: true,
    demo: true,
    fee: true,
    active: true,
    level: true
}).partial().required({id: true});

/* === RPC === */

/* === User === */

/**
 * 내 계정의 프로필 조회
 * 사용하는 context: context.user
 * - 인증된 사용자만 접근 가능
 * - Rate Limit: 1시간에 10회
 * @returns {Promise<z.infer<typeof GetUserSchema> | null>}
 */
export const getMyProfile = rpcBuilder // 나만 접근 가능
    .use(rateLimitORPCMiddleware(10, 3600)) // 1시간에 10회 요청 가능
    .use(authOnlyORPCMiddleware)
    .handler(async ({context}) => {
        return context?.user;
    });

/**
 * 내 계정의 프로필 수정
 * 사용하는 context: context.user
 * - 인증된 사용자만 접근 가능
 * - Rate Limit: 1시간에 10회
 * @param {z.infer<typeof UpdateUserSchema>} input
 * @returns {Promise<z.infer<typeof GetUserSchema>>}
 */
export const updateMyProfile = rpcBuilder // 나만 접근 가능
    .use(rateLimitORPCMiddleware(10, 3600)) // 1시간에 10회 요청 가능
    .use(authOnlyORPCMiddleware)
    .input(UpdateUserSchema)
    .handler(async ({input, context, errors}) => {
        const [updatedUser] = await orm.update(users).set({
            name: input.name,
            email: input.email,
            password: input.password ? await argon2.hash(input.password) : undefined,
        }).where(eq(users.id, context.user!.id)).returning({
            id: users.id,
            name: users.name,
            email: users.email
        });

        if (!updatedUser) { // 업데이트된 행이 없으면 존재하지 않는 사용자
            throw errors.CONFLICT({
                message: `User ID ${context.user!.id} does not exist`,
                data: {field: 'id', value: `${context.user!.id}`}
            });
        }

        await redis.del(`user:${context.user!.id}`); // 안전을 위해 캐시 삭제
        return updatedUser as z.infer<typeof GetUserSchema>;
    });

/**
 * 사용자 등록
 * 사용하는 context: context.ip
 * - Rate Limit: 1시간에 5회
 * - 현재는 비활성화된 상태로 등록됨 (관리자가 활성화 필요)
 * @param {z.infer<typeof RegisterUserSchema>} input
 * @returns {Promise<z.infer<typeof GetUserSchema>>}
 */
export const registerUser = rpcBuilder // 비활성화된 상태로 사용자 등록
    .use(rateLimitORPCMiddleware(5, 3600)) // 1시간에 5회 요청 가능
    .use(verifiedDeviceOnlyORPCMiddleware)
    .input(RegisterUserSchema)
    .handler(async ({input, errors, context}) => {
        // Allow creating the very first user as an admin bypassing email confirmation.
        // If any user already exists, keep registration disabled.
        try {
            const existing = await orm.query.users.findFirst();

            if (!existing) {
                // No users yet — create the initial admin user (active, emailVerified, admin)
                const [newUser] = await orm.insert(users).values({
                    name: input.name,
                    email: input.email.toLowerCase(),
                    password: await argon2.hash(input.password),
                    admin: true,
                    demo: false,
                    fee: -1,
                    active: true,
                    level: 9999,
                    emailVerified: true
                }).returning({
                    id: users.id,
                    name: users.name,
                    email: users.email,
                    admin: users.admin,
                    demo: users.demo,
                    fee: users.fee,
                    active: users.active,
                    level: users.level,
                    emailVerified: users.emailVerified
                });

                if (newUser) {
                    logger.info(`Initial admin user created: ID=${newUser.id}, Email=${newUser.email}, IP=${context.ip}`);
                    // No confirmation email is sent for the initial admin.
                    return newUser as z.infer<typeof GetUserSchema>;
                }

                throw errors.INTERNAL_SERVER_ERROR({ message: 'Failed to create initial user' });
            }

            // If there are existing users, keep registration disabled.
            throw errors.BAD_REQUEST({ message: 'User registration is currently disabled' });
        } catch (e) {
            if (e instanceof Error && e.message.includes('users_email_key')) {
                throw errors.CONFLICT({
                    message: `Email ${input.email} already exists`
                });
            } else if (e instanceof Error && e.message.includes('users_name_key')) {
                throw errors.CONFLICT({
                    message: `Name ${input.name} already exists`
                });
            }
            logger.error(`Failed to register (initial) user: ${e}`);
            throw errors.INTERNAL_SERVER_ERROR({ message: 'Failed to register user' });
        }
        // try {
        //     const [newUser] = await orm.insert(users).values({
        //         name: input.name,
        //         email: input.email.toLowerCase(),
        //         password: await argon2.hash(input.password),
        //         admin: false,
        //         demo: false,
        //         fee: -1,
        //         active: false
        //     }).returning({
        //         id: users.id,
        //         name: users.name,
        //         email: users.email
        //     });
        //
        //     if (newUser) {
        //         logger.info(`New user registered: ID=${newUser.id}, Email=${newUser.email}, IP=${context.ip}`);
        //         const token = randomBytes(64).toString('hex');
        //
        //         try {
        //             await limit(() => mailSender.sendMail({
        //                 from: `"PJS2" <${env.SMTP_FROM}>`,
        //                 to: newUser.email,
        //                 subject: 'PJS2 Account Registration Confirmation',
        //                 text: `To confirm your account registration, please click the link below:\n\n` +
        //                     `${escape(env.ORIGIN)}/auth/confirm/${escape(token)}\n\n` +
        //                     `This link will expire in 24 hours.\n\n` +
        //                     `If you did not register an account, please ignore this email.`,
        //                 html: `<p>To confirm your account registration, please click the link below:</p>` +
        //                     `<p><a href="${escape(env.ORIGIN)}/auth/confirm/${escape(token)}">Confirm Registration</a></p>` +
        //                     `<p>This link will expire in 24 hours.</p>` +
        //                     `<p>If you did not register an account, please ignore this email.</p>`
        //             }));
        //
        //             await redis.set(
        //                 `register:${token}`,
        //                 JSON.stringify({
        //                     userId: newUser.id,
        //                     ip: context.ip,
        //                     createdAt: Date.now()
        //                 }), 'EX', 24 * 60 * 60 // 24시간
        //             );
        //         } catch (e) {
        //             logger.error('Failed to send recovery email:', e);
        //         }
        //
        //         return newUser as z.infer<typeof GetUserSchema>;
        //     }
        //
        //     throw errors.INTERNAL_SERVER_ERROR({
        //         message: 'Failed to register user for unknown reasons'
        //     });
        // } catch (e) {
        //     if (e instanceof Error && e.message.includes('users_email_key')) {
        //         throw errors.CONFLICT({
        //             message: `Email ${input.email} already exists`
        //         });
        //     } else if (e instanceof Error && e.message.includes('users_name_key')) {
        //         throw errors.CONFLICT({
        //             message: `Name ${input.name} already exists`
        //         });
        //     } else {
        //         logger.error(`Failed to register user: ${e}`);
        //         throw errors.INTERNAL_SERVER_ERROR({
        //             message: `Failed to register user`
        //         });
        //     }
        // }
    });

/**
 * 사용자 로그인
 * 사용하는 context: context.cookies, context.ip, context.deviceId
 * - Rate Limit: 10분에 15회
 * @param {z.infer<typeof LoginUserSchema>} input
 * @returns {Promise<{message: string}>}
 */
export const loginUser = rpcBuilder // 사용자 로그인
    .use(rateLimitORPCMiddleware(15, 600)) // 10분에 15회 요청 가능
    .use(verifiedDeviceOnlyORPCMiddleware)
    .input(LoginUserSchema)
    .handler(async ({input, errors, context}) => {
        const email = input.email.toLowerCase();
        const password = input.password;

        logger.info(`Login attempt for email: ${email} from IP: ${context.ip} and Device ID: ${context.deviceId}`);
        const userData = await orm.query.users.findFirst({
            where: (users, {eq}) => eq(users.email, email)
        });

        const isPasswordValid = userData?.password ? await argon2.verify(userData.password, password) : false;

        if (userData === null || !isPasswordValid) { // 사용자 없거나 비밀번호 틀림
            logger.warn(`Failed login attempt for email: ${email} from IP: ${context.ip} and Device ID: ${context.deviceId}`);
            throw errors.UNAUTHORIZED({
                message: 'Invalid email or password'
            });
        }

        if (!userData?.active) { // 비활성화 계정
            logger.warn(`Inactive account login attempt for email: ${email} from IP: ${context.ip} and Device ID: ${context.deviceId}`);
            throw errors.FORBIDDEN({
                message: 'Account is inactive'
            });
        }

        const sessionId = "PJS2S_" + randomBytes(64).toString('hex');

        const userSessionsKey = `user:${userData.id}:sessions`;
        const existingSessions = await redis.smembers(userSessionsKey);

        const MAX_SESSIONS = 5; // 최대 동시 세션 수 제한 (보통 수정할 필요가 없어서 하드 코딩)
        const pipeline = redis.pipeline();

        if (existingSessions.length >= MAX_SESSIONS && email !== "tuser@0ghost0.xyz") {
            const oldestSession = existingSessions[0];
            pipeline.del(`session:${oldestSession}`);
            pipeline.srem(userSessionsKey, oldestSession);
        }

        pipeline.set(
            `session:${sessionId}`,
            JSON.stringify({
                userId: userData?.id,
                deviceId: context?.deviceId,
                createdAt: Date.now()
            }), 'EX', 60 * 60 * 24 * 7 // 7일
        );

        pipeline.sadd(userSessionsKey, sessionId);
        pipeline.expire(userSessionsKey, 60 * 60 * 24 * 7);

        await pipeline.exec();

        context.cookies?.set('session_id', sessionId, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 60 * 60 * 24 * 7, // 7일
            path: '/',
        });

        return {
            message: 'Login successful'
        }
    });

/**
 * 사용자 로그아웃
 * 사용하는 context: context.cookies
 * - 인증된 사용자만 접근 가능
 * @returns {Promise<{message: string}>}
 */
export const logoutUser = rpcBuilder
    .handler(async ({context}) => {
        const sessionId = context.cookies?.get('session_id');

        if (sessionId) {
            const sessionData = await redis.get(`session:${sessionId}`);
            if (sessionData) {
                const {userId} = JSON.parse(sessionData);
                const pipeline = redis.pipeline();
                pipeline.srem(`user:${userId}:sessions`, sessionId);
                pipeline.del(`session:${sessionId}`);
                await pipeline.exec();
            } else {
                await redis.del(`session:${sessionId}`);
            }
            context.cookies?.delete('session_id', {
                path: '/',
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict'
            });
        }

        return {
            message: 'Logged out successfully'
        };
    });

/**
 * 비밀번호 재설정 토큰 생성 및 이메일 발송
 * 사용하는 context: context.ip
 * - Rate Limit: 1시간에 5회
 * @param {z.infer<typeof RecoveryPasswordSchema>} input
 * @returns {Promise<{message: string}>}
 */
export const createRecoveryToken = rpcBuilder // 비밀번호 재설정 이메일 발송
    .use(rateLimitORPCMiddleware(5, 3600)) // 1시간에 5회 요청 가능
    .use(verifiedDeviceOnlyORPCMiddleware)
    .input(RecoveryPasswordSchema)
    .handler(async ({input, context}) => {
        const email = input.email.toLowerCase();

        if (email !== "tuser@0ghost0.xyz") return {
            message: 'If the email exists, a recovery link has been sent.'
        }

        const userData = await orm.query.users.findFirst({
            where: (users, {eq}) => eq(users.email, email)
        });

        // 백그라운드에서 이메일 발송 (사용자 응답과 무관하게 동일한 시간에 응답)
        if (userData) {
            const token = randomBytes(64).toString('hex');

            // 응답 후 백그라운드에서 실행
            (async () => {
                try {
                    await limit(() => mailSender.sendMail({
                        from: `"PJS2" <${env.SMTP_FROM}>`,
                        to: email,
                        subject: 'PJS2 Password Recovery',
                        text: `To reset your password, please click the link below:\n\n` +
                            `${escape(env.ORIGIN)}/auth/recovery/${escape(token)}\n\n` +
                            `This link will expire in 15 minutes.\n\n` +
                            `If you did not request a password reset, please ignore this email.`,
                        html: `<p>To reset your password, please click the link below:</p>` +
                            `<p><a href="${escape(env.ORIGIN)}/auth/recovery/${escape(token)}">Reset Password</a></p>` +
                            `<p>This link will expire in 15 minutes.</p>` +
                            `<p>If you did not request a password reset, please ignore this email.</p>`
                    }));

                    await redis.set(
                        `recovery:${token}`,
                        JSON.stringify({
                            userId: userData.id,
                            ip: context.ip,
                            createdAt: Date.now()
                        }), 'EX', 60 * 15 // 15분
                    );
                } catch (e) {
                    console.error('Failed to send recovery email:', e);
                }
            })().then();
        }

        return {
            message: 'If the email exists, a recovery link has been sent.'
        }
    });

/**
 * 비밀번호 재설정 토큰 유효성 검사
 * - Rate Limit: 10분에 10회
 * @param {object} input
 * @param {string} input.token - 비밀번호 재설정 토큰
 * @returns {Promise<{message: string}>}
 */
export const isRecoveryTokenValid = rpcBuilder // 비밀번호 재설정 토큰 유효성 검사
    .use(rateLimitORPCMiddleware(10, 600)) // 10분에 10회 요청 가능
    .use(verifiedDeviceOnlyORPCMiddleware)
    .input(z.object({
        token: z.string().max(128)
    }))
    .handler(async ({input, errors}) => {
        const token = input.token;

        const tokenData = await redis.get(`recovery:${token}`);
        if (!tokenData) {
            throw errors.NOT_FOUND({
                message: 'Invalid or expired token'
            });
        }

        return {
            message: 'OK'
        };
    });

/**
 * 비밀번호 재설정
 * 사용하는 context: context.ip
 * - Rate Limit: 1시간에 5회
 * @param {object} input
 * @param {string} input.token - 비밀번호 재설정 토큰
 * @param {string} input.password - 새로운 비밀번호
 * @returns {Promise<{message: string}>}
 */
export const recoveryPassword = rpcBuilder // 비밀번호 재설정
    .use(rateLimitORPCMiddleware(5, 3600)) // 1시간에 5회 요청 가능
    .use(verifiedDeviceOnlyORPCMiddleware)
    .input(z.object({
        token: z.string().max(128),
        password: z.string().min(8).max(64),
    }))
    .handler(async ({input, errors}) => {
        const token = input.token;
        const newPassword = input.password;

        const tokenData = await redis.get(`recovery:${token}`);
        const parsedTokenData = tokenData ? JSON.parse(tokenData) : null;
        if (!tokenData) {
            throw errors.NOT_FOUND({
                message: 'Invalid or expired token'
            });
        }

        const [updatedUser] = await orm.update(users).set({
            password: await argon2.hash(newPassword)
        }).where(eq(users.id, parsedTokenData.userId)).returning({
            id: users.id,
            name: users.name,
            email: users.email
        });

        if (!updatedUser) { // 업데이트된 행이 없으면 존재하지 않는 사용자
            throw errors.NOT_FOUND({
                message: `User ID ${parsedTokenData.userId} does not exist`,
                data: {field: 'id', value: parsedTokenData.userId}
            });
        }

        await redis.pipeline()
            .del(`user:${parsedTokenData.userId}`) // 캐시 삭제
            .del(`recovery:${token}`) // 토큰 사용 후 삭제
            .exec();

        return {
            message: 'Password has been reset successfully'
        };
    });

/**
 * 이메일 인증 재전송
 * 사용하는 context: context.user
 * - 인증된 사용자만 접근 가능
 * - Rate Limit: 1시간에 5회
 * @returns {Promise<{message: string}>}
 */
export const resendVerificationEmail = rpcBuilder
    .use(rateLimitORPCMiddleware(5, 3600)) // 1시간에 5회 요청 가능
    .use(authOnlyORPCMiddleware)
    .handler(async ({context, errors}) => {
        const userId = context.user!.id;
        const userEmail = context.user!.email;
        const token = randomBytes(64).toString('hex');

        try {
            await limit(() => mailSender.sendMail({
                from: `"PJS2" <${env.SMTP_FROM}>`,
                to: userEmail,
                subject: 'PJS2 Email Verification',
                text: `To verify your email, please click the link below:\n\n` +
                    `${escape(env.ORIGIN)}/auth/confirm/${escape(token)}\n\n` +
                    `This link will expire in 24 hours.\n\n` +
                    `If you did not request this, please ignore this email.`,
                html: `<p>To verify your email, please click the link below:</p>` +
                    `<p><a href="${escape(env.ORIGIN)}/auth/confirm/${escape(token)}">Verify Email</a></p>` +
                    `<p>This link will expire in 24 hours.</p>` +
                    `<p>If you did not request this, please ignore this email.</p>`
            }));

            await redis.set(
                `register:${token}`,
                JSON.stringify({
                    userId: userId,
                    createdAt: Date.now()
                }), 'EX', 24 * 60 * 60 // 24시간
            );
        } catch (e) {
            console.error('Failed to send verification email:', e);
            throw errors.INTERNAL_SERVER_ERROR({
                message: 'Failed to resend verification email'
            });
        }

        return {
            message: 'Verification email resent'
        };
    });

/**
 * 이메일 인증
 * 사용하는 context: 없음
 * - Rate Limit: 1시간에 10회
 * @param {object} input
 * @param {string} input.token - 이메일 인증 토큰
 * @returns {Promise<{message: string}>}
 */
export const verifyEmail = rpcBuilder
    .use(rateLimitORPCMiddleware(10, 3600)) // 1시간에 10회 요청 가능
    .use(verifiedDeviceOnlyORPCMiddleware)
    .input(z.object({
        token: z.string().max(128)
    }))
    .handler(async ({input, errors}) => {
        const token = input.token;
        const tokenData = await redis.get(`register:${token}`);
        const parsedTokenData = tokenData ? JSON.parse(tokenData) : null;

        if (!tokenData) {
            throw errors.NOT_FOUND({
                message: 'Invalid or expired token'
            });
        }

        const [updatedUser] = await orm.update(users).set({
            emailVerified: true
        }).where(eq(users.id, parsedTokenData.userId)).returning({
            id: users.id,
            name: users.name,
            email: users.email,
            emailVerified: users.emailVerified
        });


        if (!updatedUser) { // 업데이트된 행이 없으면 존재하지 않는 사용자
            throw errors.NOT_FOUND({
                message: `User ID ${parsedTokenData.userId} does not exist`,
                data: {field: 'id', value: parsedTokenData.userId}
            });
        }

        await redis.pipeline()
            .del(`user:${parsedTokenData.userId}`) // 캐시 삭제
            .del(`register:${token}`) // 토큰 사용 후 삭제
            .exec();

        return {
            message: 'Email verified successfully'
        };
    });

/* === Admin === */

/**
 * 특정 사용자 정보 조회
 * - 관리자만 접근 가능
 * @param {z.infer<typeof GetUserSchema>} input
 * @returns {Promise<z.infer<typeof GetUserSchema>>}
 */
export const getUser = rpcBuilder // 관리자만 접근 가능
    .use(adminOnlyORPCMiddleware)
    .input(GetUserSchema.pick({id: true}).required({id: true}))
    .handler(async ({input, errors}) => {
        const userId = input.id;
        const cachedUser = await redis.get(`user:${userId}`);
        if (cachedUser) {
            return JSON.parse(cachedUser) as z.infer<typeof UserDefaultSchema>;
        }

        const userData = await orm.query.users.findFirst({
            where: (users, {eq}) => eq(users.id, userId),
            columns: {password: false} // 비밀번호 제외
        });

        if (!userData) {
            throw errors.NOT_FOUND({
                message: 'User not found'
            });
        }

        await redis.set(`user:${userId}`, JSON.stringify({
            ...userData,
        }), 'EX', 3600); // 1시간 캐시

        return userData as z.infer<typeof UserDefaultSchema>;
    });

/**
 * 모든 사용자 정보 조회 (페이징)
 * - 관리자만 접근 가능
 * @param {object} input
 * @param {number} input.page - 페이지 번호 (1부터 시작)
 * @param {number} input.pageSize - 페이지당 사용자 수 (최대 100)
 * @returns {Promise<{data: z.infer<typeof GetUserSchema>[], pagination: {page: number, pageSize: number, total: number, totalPages: number}}>}
 */
export const getAllUsers = rpcBuilder // 관리자만 접근 가능
    .use(adminOnlyORPCMiddleware)
    .input(z.object({
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(100).default(50)
    }))
    .handler(async ({input}) => {
        const offset = (input.page - 1) * input.pageSize;
        const Users = await orm.select({
            id: users.id,
            name: users.name,
            email: users.email,
            created_at: users.createdAt,
            updated_at: users.updatedAt,
            admin: users.admin,
            demo: users.demo,
            fee: users.fee,
            active: users.active,
            emailVerified: users.emailVerified
        }).from(users).orderBy(asc(users.id)).limit(input.pageSize).offset(offset);

        const total = await orm.select({count: sql`count(*)`}).from(users);

        return {
            data: Users,
            pagination: {
                page: input.page,
                pageSize: input.pageSize,
                total: total[0].count,
                totalPages: Math.ceil(total[0].count as number / input.pageSize)
            }
        };
    });

/**
 * 새 사용자 생성
 * - 관리자만 접근 가능
 * @param {z.infer<typeof UserDefaultSchema>} input
 * @returns {Promise<z.infer<typeof GetUserSchema>>}
 */
export const createUser = rpcBuilder // 관리자만 사용자 생성 가능
    .use(adminOnlyORPCMiddleware)
    .input(UserDefaultSchema)
    .handler(async ({input, errors}) => {
        try {
            const [newUser] = await orm.insert(users).values({
                name: input.name,
                email: input.email.toLowerCase(),
                password: await argon2.hash(input.password),
                admin: input.admin ?? false,
                demo: input.demo ?? false,
                fee: input.fee ?? -1,
                active: input.active ?? false,
                level: input.level ?? 0,
            }).returning({
                id: users.id,
                name: users.name,
                email: users.email,
                admin: users.admin,
                demo: users.demo,
                fee: users.fee,
                active: users.active,
                level: users.level
            });

            return newUser as z.infer<typeof GetUserSchema>;
        } catch (e) {
            if (e instanceof Error && e.message.includes('users_email_key')) {
                throw errors.CONFLICT({
                    message: `Email ${input.email} already exists`
                });
            } else if (e instanceof Error && e.message.includes('users_name_key')) {
                throw errors.CONFLICT({
                    message: `Name ${input.name} already exists`
                });
            } else {
                throw errors.INTERNAL_SERVER_ERROR({
                    message: `Failed to create user: ${e}`
                });
            }
        }
    });

/**
 * 특정 사용자 정보 수정 (비밀번호 제외)
 * - 관리자만 접근 가능
 * @param {z.infer<typeof UpdateUserByIDSchema>} input
 * @returns {Promise<z.infer<typeof GetUserSchema>>}
 */
export const updateUserByID = rpcBuilder // 관리자만 사용자 수정 가능
    .use(adminOnlyORPCMiddleware)
    .input(UpdateUserByIDSchema)
    .handler(async ({input, errors}) => {
        if (!input.id) {
            throw errors.BAD_REQUEST({
                message: 'User ID is required for update'
            });
        }

        const [updatedUser] = await orm.update(users).set({
            name: input.name,
            email: input.email ? input.email.toLowerCase() : undefined,
            admin: input.admin,
            demo: input.demo,
            fee: input.fee,
            active: input.active,
            level: input.level
        }).where(eq(users.id, input.id)).returning({
            id: users.id,
            name: users.name,
            email: users.email,
            admin: users.admin,
            demo: users.demo,
            fee: users.fee,
            active: users.active,
            level: users.level
        });

        if (!updatedUser) { // 업데이트된 행이 없으면 존재하지 않는 사용자
            throw errors.NOT_FOUND({
                message: `User ID ${input.id} does not exist`,
                data: {field: 'id', value: `${input.id}`}
            });
        }

        await redis.del(`user:${input.id}`); // 안전을 위해 캐시 삭제
        return updatedUser as z.infer<typeof GetUserSchema>;
    });

/**
 * 특정 사용자 활성화/비활성화
 * - 관리자만 접근 가능
 * @param {z.infer<typeof UserDefaultSchema>} input
 * @returns {Promise<z.infer<typeof GetUserSchema>>}
 */
export const activateUserByID = rpcBuilder // 관리자만 사용자 활성화 가능
    .use(adminOnlyORPCMiddleware)
    .input(UserDefaultSchema.pick({id: true}))
    .handler(async ({input, errors}) => {
        if (!input.id) {
            throw errors.BAD_REQUEST({
                message: 'User ID is required for activation'
            });
        }

        const [updatedUser] = await orm.update(users).set({
            active: true
        }).where(eq(users.id, input.id)).returning({
            id: users.id,
            name: users.name,
            email: users.email,
            admin: users.admin,
            demo: users.demo,
            fee: users.fee,
            active: users.active
        });

        if (!updatedUser) { // 업데이트된 행이 없으면 존재하지 않는 사용자
            throw errors.NOT_FOUND({
                message: `User ID ${input.id} does not exist`,
                data: {field: 'id', value: `${input.id}`}
            });
        }

        await redis.del(`user:${input.id}`); // 안전을 위해 캐시 삭제
        return updatedUser as z.infer<typeof GetUserSchema>;
    });

/**
 * 특정 사용자 비활성화
 * - 관리자만 접근 가능
 * @param {z.infer<typeof UserDefaultSchema>} input
 * @returns {Promise<z.infer<typeof GetUserSchema>>}
 */
export const deactivateUserByID = rpcBuilder // 관리자만 사용자 비활성화 가능
    .use(adminOnlyORPCMiddleware)
    .input(UserDefaultSchema.pick({id: true}))
    .handler(async ({input, errors}) => {
        if (!input.id) {
            throw errors.BAD_REQUEST({
                message: 'User ID is required for deactivation'
            });
        }

        const [updatedUser] = await orm.update(users).set({
            active: false
        }).where(eq(users.id, input.id)).returning({
            id: users.id,
            name: users.name,
            email: users.email,
            admin: users.admin,
            demo: users.demo,
            fee: users.fee,
            active: users.active
        });

        if (!updatedUser) { // 업데이트된 행이 없으면 존재하지 않는 사용자
            throw errors.NOT_FOUND({
                message: `User ID ${input.id} does not exist`,
                data: {field: 'id', value: `${input.id}`}
            });
        }

        await redis.del(`user:${input.id}`); // 안전을 위해 캐시 삭제
        return updatedUser as z.infer<typeof GetUserSchema>;
    });