import { z } from "zod";
import { adminOnlyORPCMiddleware, rateLimitORPCMiddleware } from "$lib/server/middlewares/orpc.auth.middleware";
import { orm } from "$lib/server/postgresql/drizzle";
import { symbols } from "$lib/server/postgresql/schemas";
import { eq, and, sql } from "drizzle-orm";
import { redis } from "$lib/server/redis/db";
import { session } from "../../loader/EXC";
import { type EXC } from "../../loader/loader";
import { rpcBuilder } from "$lib/server/middlewares/orpc.builder";
import { building } from '$app/environment';

const PJSe = building
    ? { short_name: 'BUILD_TIME_PLACEHOLDER' } as EXC
    : (globalThis as any).exchange as EXC;

const SymbolDefaultSchema = z.object({ // 심볼 기본 스키마
    symbol: z.string().min(1).max(50).regex(/^[A-Z0-9]+$/, "Symbol must be uppercase alphanumeric"),
    name: z.string().min(1).max(100),
    detail: z.string().optional(),
    url: z.url().optional(),
    logo: z.url().optional(),
    market: z.string().min(1).max(100).default(PJSe.short_name),
    type: z.enum(['stock', 'bond', 'etf', 'crypto']).default('stock'),
    minimum_order_quantity: z.number().min(0).default(1),
    tick_size: z.number().min(0).default(1),
    total_shares: z.number().min(0).default(0),
    ipo_price: z.number().min(0).default(0),
    tags: z.array(z.string()).optional(),
    status: z.object({
        status: z.enum(['init', 'active', 'inactive', 'delisted', 'suspended']).default('init'),
        reason: z.string().optional()
    }).optional()
});

const SymbolGetSchema = SymbolDefaultSchema.pick({ // 심볼 조회 스키마
    symbol: true
});

const SymbolUpdateSchema = SymbolDefaultSchema.pick({ // 심볼 수정 스키마
    symbol: true,
    name: true,
    detail: true,
    url: true,
    logo: true,
    minimum_order_quantity: true,
    tick_size: true,
    total_shares: true,
    tags: true,
    status: true
}).partial().required({symbol: true}); // symbol은 필수

/* === RPC === */

/* === User === */

/**
 * 심볼 정보 조회 (민감한 데이터 제외) - 캐싱 적용
 * - 누구나 접근 가능
 * - 캐시에 없으면 DB에서 조회 후 캐싱
 * - 세션이 종료되지 않은 경우에만 캐싱 (장이 종료되면 캐시를 삭제하기 때문에 TTL은 설정하지 않음)
 * - Rate Limit: 1분에 150회
 * @throws {NOT_FOUND} 심볼이 존재하지 않거나 init 상태인 경우
 * @throws {CONFLICT} 심볼이 delisted 상태인 경우
 * @throws {CONFLICT} 심볼이 active나 inactive나 suspended 상태가 아닌 경우
 * @returns 심볼 정보
 */
export const getSymbol = rpcBuilder
    .use(rateLimitORPCMiddleware(150, 60))
    .input(SymbolGetSchema)
    .handler(async ({input, errors}) => {
        let symbolData: any;
        symbolData = await redis.get(`symbol:${input.symbol}`);
        symbolData = symbolData ? JSON.parse(symbolData) : null;
        if (!symbolData) { // 캐시에 없으면 DB에서 조회
            symbolData = await orm.query.symbols.findFirst({
                where: (symbols, {eq}) => eq(symbols.symbol, input.symbol!),
                columns: {id: false} // id 컬럼은 제외
            });

            if (!symbolData) { // DB에도 없으면 잘못된 심볼
                throw errors.NOT_FOUND({
                    message: `Symbol ${input.symbol} not found`,
                    data: {field: 'symbol', value: input.symbol}
                });
            }

            if (session.session !== "closed") { // 세션이 종료되지 않은 경우에만 캐싱 (장이 종료되면 캐시를 삭제하기 때문에 TTL은 설정하지 않음)
                await redis.set(`symbol:${input.symbol}`, JSON.stringify(symbolData));
            }
        }

        const status = symbolData.status as { status: string, reason: string };
        if (status.status !== "active" && status.status !== "inactive" && status.status !== "suspended") { // active나 inactive 상태가 아니면 노출 금지
            if (status.status === "delisted") {
                throw errors.CONFLICT({
                    message: `Symbol is ${status.status}: ${status.reason}`,
                    data: {field: 'symbol', value: input.symbol, reason: status.reason}
                });
            }
            if (status.status === "init") { // init 상태는 아직 상장 전이므로 not found로 처리
                throw errors.NOT_FOUND({
                    message: `Symbol ${input.symbol} not found`,
                    data: {field: 'symbol', value: input.symbol}
                });
            }

            throw errors.CONFLICT({
                message: "Symbol is not active",
                data: {field: 'symbol', value: input.symbol}
            });
        }

        return {
            symbol: symbolData.symbol,
            name: symbolData.name,
            detail: symbolData.detail,
            url: symbolData.url,
            logo: symbolData.logo,
            market: symbolData.market,
            type: symbolData.type,
            total_shares: symbolData.total_shares,
            ipo_price: symbolData.ipo_price,
            minimum_order_quantity: symbolData.minimum_order_quantity,
            tick_size: symbolData.tick_size,
            tags: symbolData.tags,
            status: symbolData.status
        };
    });

/**
 * 심볼 목록 조회 (민감한 데이터 제외) - 페이징 처리
 * - 누구나 접근 가능
 * - Rate Limit: 10분에 100회
 * @param page 페이지 번호 (1부터 시작)
 * @param pageSize 페이지 크기 (최대 100)
 * @throws {BAD_REQUEST} 잘못된 페이지 번호 또는 페이지 크기
 * @returns `{ data: Symbol[], pagination: { page: number, pageSize: number, total: number, totalPages: number } }` - 심볼 목록과 페이징 정보
 */
export const getAllSymbols = rpcBuilder
    .use(rateLimitORPCMiddleware(100, 600))
    .input(z.object({
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(100).default(50)
    }))
    .handler(async ({input}) => {
        const offset = (input.page - 1) * input.pageSize;

        const [Symbols, totalResult] = await Promise.all([
            orm.select({
                symbol: symbols.symbol,
                name: symbols.name,
                detail: symbols.detail,
                url: symbols.url,
                logo: symbols.logo,
                market: symbols.market,
                type: symbols.type,
                total_shares: symbols.total_shares,
            }).from(symbols)
                .where(
                    and(
                        sql`${symbols.status}
                        ->>'status' != 'init'`,
                        sql`${symbols.status}
                        ->>'status' != 'delisted'`
                    )
                )
                .orderBy(symbols.symbol)
                .limit(input.pageSize)
                .offset(offset),

            orm.select({count: sql`count(*)`}).from(symbols)
                .where(
                    and(
                        sql`${symbols.status}
                        ->>'status' != 'init'`,
                        sql`${symbols.status}
                        ->>'status' != 'delisted'`
                    )
                )
        ]);

        return {
            data: Symbols,
            pagination: {
                page: input.page,
                pageSize: input.pageSize,
                total: totalResult[0].count,
                totalPages: Math.ceil(totalResult[0].count as number / input.pageSize)
            }
        };
    });

/* === Admin === */

/**
 * 심볼 정보 조회 (모든 데이터 포함)
 * - 관리자만 접근 가능
 * @throws {NOT_FOUND} 심볼이 존재하지 않는 경우
 * @returns 심볼 정보
 */
export const getSymbolAdmin = rpcBuilder
    .use(adminOnlyORPCMiddleware)
    .input(SymbolGetSchema)
    .handler(async ({input, errors}) => {
        const symbol = await orm.select().from(symbols).where(eq(symbols.symbol, input.symbol)).limit(1);

        if (symbol.length === 0) {
            throw errors.NOT_FOUND({
                message: `Symbol ${input.symbol} not found`,
                data: {field: 'symbol', value: input.symbol}
            });
        }
        return symbol[0];
    });

/**
 * 심볼 목록 조회 (모든 데이터 포함) - 페이징 처리
 * - 관리자만 접근 가능
 * @param page 페이지 번호 (1부터 시작)
 * @param pageSize 페이지 크기 (최대 100)
 * @throws {BAD_REQUEST} 잘못된 페이지 번호 또는 페이지 크기
 * @returns `{ data: Symbol[], pagination: { page: number, pageSize: number, total: number, totalPages: number } }` - 심볼 목록과 페이징 정보
 */
export const getAllSymbolsAdmin = rpcBuilder
    .use(adminOnlyORPCMiddleware)
    .input(z.object({
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(100).default(50)
    }))
    .handler(async ({input}) => {
        const offset = (input.page - 1) * input.pageSize;

        const [Symbols, total] = await Promise.all([
            orm.select().from(symbols)
                .orderBy(symbols.symbol)
                .limit(input.pageSize)
                .offset(offset),

            orm.select({count: sql`count(*)`}).from(symbols)
        ]);

        return {
            data: Symbols,
            pagination: {
                page: input.page,
                pageSize: input.pageSize,
                total: total[0].count,
                totalPages: Math.ceil(total[0].count as number / input.pageSize)
            }
        };
    });

/**
 * 심볼 상장 (신규 심볼 등록)
 * - 관리자만 접근 가능
 * @throws {CONFLICT} 심볼이 이미 존재하는 경우
 * @throws {BAD_REQUEST} 심볼 등록에 실패한 경우
 * @returns 등록된 심볼 정보
 */
export const listingSymbol = rpcBuilder
    .use(adminOnlyORPCMiddleware)
    .input(SymbolDefaultSchema)
    .handler(async ({input, errors}) => {
        try {
            const [newSymbol] = await orm.insert(symbols).values({
                symbol: input.symbol,
                name: input.name,
                detail: input.detail,
                url: input.url,
                logo: input.logo,
                market: input.market,
                type: input.type,
                minimum_order_quantity: input.minimum_order_quantity,
                tick_size: input.tick_size,
                total_shares: input.total_shares,
                ipo_price: input.ipo_price
            }).returning({
                symbol: symbols.symbol,
                name: symbols.name,
                detail: symbols.detail,
                url: symbols.url,
                logo: symbols.logo,
                market: symbols.market,
                type: symbols.type,
                minimum_order_quantity: symbols.minimum_order_quantity,
                tick_size: symbols.tick_size,
                total_shares: symbols.total_shares,
                ipo_price: symbols.ipo_price
            });

            return newSymbol;
        } catch (error) {
            if ((error as any).cause.errno === '23505') {
                throw errors.CONFLICT({
                    message: `Symbol ${input.symbol} already exists`,
                    data: {field: 'symbol', value: input.symbol}
                });
            }
            throw errors.BAD_REQUEST({
                message: 'Failed to list symbol',
                data: {field: 'symbol', value: input.symbol, reason: error as any}
            });
        }
    });

/**
 * 심볼 거래 대기 상태로 변경 (init -> inactive)
 * - 관리자만 접근 가능
 * - init 상태인 심볼만 변경 가능
 * @throws {CONFLICT} 심볼이 존재하지 않거나 init 상태가 아닌 경우
 * @returns 변경된 심볼 정보
 */
export const inactivateSymbol = rpcBuilder // 관리자만 접근 가능
    .use(adminOnlyORPCMiddleware)
    .input(SymbolGetSchema)
    .handler(async ({input, errors}) => {
        const [updatedSymbol] = await orm.update(symbols).set({
            status: JSON.stringify({status: 'inactive', reason: 'Ready To Trade'})
        }).where(
            and(
                eq(symbols.symbol, input.symbol),
                eq(symbols.status, JSON.stringify({status: 'init'}))
            )
        ).returning({
            symbol: symbols.symbol,
            status: symbols.status
        });

        if (!updatedSymbol) { // 업데이트된 행이 없으면 존재하지 않거나 init 상태가 아님
            throw errors.CONFLICT({
                message: `Symbol ${input.symbol} does not exist or is not in 'init' status`,
                data: {field: 'symbol', value: input.symbol}
            });
        }

        await redis.del(`symbol:${input.symbol}`); // 업데이트 성공 시에만 캐시 삭제

        return updatedSymbol;
    });

/**
 * 심볼 상태 변경 (active, delisted, suspended)
 * - 관리자만 접근 가능
 * - delisted나 suspended 상태로 변경할 때는 이유가 필수
 * @throws {BAD_REQUEST} delisted나 suspended 상태로 변경할 때 이유가 없는 경우
 * @throws {CONFLICT} 심볼이 존재하지 않는 경우
 * @returns 변경된 심볼 정보
 */
export const updateSymbolStatus = rpcBuilder // 관리자만 접근 가능
    .use(adminOnlyORPCMiddleware)
    .input(SymbolGetSchema.extend({
        status: z.object({
            status: z.enum(['active', 'delisted', 'suspended']),
            reason: z.string().optional()
        })
    }))
    .handler(async ({input, errors}) => {
        if ((input.status.status === 'delisted' || input.status.status === 'suspended') && !input.status.reason) { // delisted나 suspended 상태로 변경할 때는 이유가 필수
            throw errors.BAD_REQUEST({
                message: `Reason is required when status is ${input.status.status}`,
                data: {field: 'status.reason', value: input.status.reason}
            });
        }

        const [updatedSymbol] = await orm.update(symbols).set({
            status: JSON.stringify(input.status)
        }).where(eq(symbols.symbol, input.symbol)).returning({
            symbol: symbols.symbol,
            status: symbols.status
        });

        if (!updatedSymbol) { // 업데이트된 행이 없으면 존재하지 않는 심볼
            throw errors.CONFLICT({
                message: `Symbol ${input.symbol} does not exist`,
                data: {field: 'symbol', value: input.symbol}
            });
        }

        await redis.del(`symbol:${input.symbol}`); // 업데이트 성공 시에만 캐시 삭제

        return updatedSymbol;
    });

/**
 * 심볼 정보 수정
 * - 관리자만 접근 가능
 * @param symbol 심볼 (필수) - 수정 불가
 * @param name 심볼 이름
 * @param detail 심볼 상세 설명
 * @param url 심볼 관련 URL
 * @param logo 심볼 로고 URL
 * @param minimum_order_quantity 최소 주문 수량
 * @param tick_size 호가 단위
 * @param total_shares 총 발행 주식 수
 * @param tags 심볼 태그
 * @param status 심볼 상태 (status: active, inactive, delisted, suspended / reason: 상태 변경 이유)
 * @throws {CONFLICT} 심볼이 존재하지 않는 경우
 * @returns 변경된 심볼 정보
 */
export const updateSymbol = rpcBuilder // 관리자만 접근 가능
    .use(adminOnlyORPCMiddleware)
    .input(SymbolUpdateSchema) // symbol을 필수로 설정
    .handler(async ({input, errors}) => {
        const [updatedSymbol] = await orm.update(symbols).set({
            name: input.name,
            detail: input.detail,
            url: input.url,
            logo: input.logo,
            minimum_order_quantity: input.minimum_order_quantity,
            tick_size: input.tick_size,
            total_shares: input.total_shares,
            tags: input.tags,
            status: input.status
        }).where(eq(symbols.symbol, input.symbol)).returning({
            symbol: symbols.symbol,
            name: symbols.name,
            detail: symbols.detail,
            url: symbols.url,
            logo: symbols.logo,
            market: symbols.market,
            type: symbols.type,
            minimum_order_quantity: symbols.minimum_order_quantity,
            tick_size: symbols.tick_size,
            total_shares: symbols.total_shares,
            ipo_price: symbols.ipo_price
        });

        if (!updatedSymbol) { // 업데이트된 행이 없으면 존재하지 않는 심볼
            throw errors.CONFLICT({
                message: `Symbol ${input.symbol} does not exist`,
                data: {field: 'symbol', value: input.symbol}
            });
        }

        await redis.del(`symbol:${input.symbol}`); // 업데이트 성공 시에만 캐시 삭제

        return updatedSymbol;
    });