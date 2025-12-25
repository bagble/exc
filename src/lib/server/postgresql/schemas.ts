import {
    pgTable,
    serial,
    text,
    varchar,
    timestamp,
    boolean,
    doublePrecision,
    bigint,
    jsonb,
    integer
} from 'drizzle-orm/pg-core';

/* 일반 데이터 테이블 정의 */

/**
 * 사용자 정보
 */
export const users = pgTable('users', {
    id: serial('id').primaryKey(),
    name: varchar('name', {length: 255}).notNull().unique(),
    email: varchar('email', {length: 255}).notNull().unique(),
    password: text('password').notNull(),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
    admin: boolean('admin').default(false),
    demo: boolean('demo').default(false),
    fee: doublePrecision('fee'),
    active: boolean('active').default(false),
    level: integer('level').default(0),
    emailVerified: boolean('email_verified').default(false),
});

/**
 * 사용자 포트폴리오 정보 (계좌 같은 개념)
 */
export const portfolios = pgTable('portfolios', {
    id: serial('id').primaryKey(),
    user_id: integer('user_id').notNull().references(() => users.id),
    name: varchar('name', {length: 50}).notNull(),
    detail: text('detail'),
    password: text('password').notNull(),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
    balance: doublePrecision('balance').default(0),
    holdings: jsonb('holdings').default('[]'), // { symbol: string, quantity: number, avg_price: number }[]
    listing_callauction_symbols: jsonb('listing_callauction_symbols').default('[]'), // 상장 동시호가 대상 종목
});

/**
 * 종목 정보
 */
export const symbols = pgTable('symbols', {
    id: serial('id').primaryKey(),
    symbol: varchar('symbol', {length: 50}).notNull().unique(),
    name: varchar('name', {length: 100}).notNull(),
    detail: text('detail'),
    url: text('url'),
    logo: text('logo'),
    market: varchar('market', {length: 100}).notNull(),
    type: varchar('type', {length: 100}).default('stock'),
    minimum_order_quantity: doublePrecision('minimum_order_quantity').default(1),
    tick_size: doublePrecision('tick_size').default(1),
    total_shares: bigint('total_shares', {mode: 'number'}).default(0),
    ipo_price: doublePrecision('ipo_price').default(0),
    tags: jsonb('tags').default('[]'),
    status: jsonb('status').default('{"status": "init", "reason": ""}'), // init | active | inactive | delisted | suspended
});

// export const apiKeys = pgTable('api_keys', { // 사용자 API 키 정보
//
// });

/* 시계열 데이터 테이블 정의 */

// export const portfolioHistories = pgTable('portfolio_histories', { // 포트폴리오 잔고 및 보유 종목 변동 이력
//     id: serial('id').primaryKey(),
//     portfolioId: varchar('portfolio_id', { length: 255 }).references(() => portfolios.id).notNull(),
//     timestamp: timestamp('timestamp').defaultNow().notNull(),
//     balance: doublePrecision('balance').notNull(),
//     change: doublePrecision('change').notNull(), // balance 변화량
//     reason: text('reason'), // change 발생 이유
//     holdings: jsonb('holdings').references(() => symbols.symbol).default('[]'), // { symbol: string, quantity: number, avg_price: number }[] // 포트폴리오 변동 사항
//     order_id: varchar('order_id', { length: 255 }).references(() => ledgers.buy_order_id || ledgers.sell_order_id), // 관련 주문 ID
// });
//
// export const ledgers = pgTable('ledgers', { // 거래 내역 (매수, 매도 등)
//     id: serial('id').primaryKey(),
//     timestamp: timestamp('timestamp').defaultNow().notNull(),
//     symbol: varchar('symbol', { length: 50 }).references(() => symbols.symbol).notNull(),
//     price: doublePrecision('price').notNull(),
//     quantity: doublePrecision('quantity').notNull(),
//     side: varchar('side', { length: 10 }).notNull(), // buy | sell
//     type: varchar('type', { length: 20 }).notNull(), // market | limit | stop | stop_limit
//     execute_id: varchar('execute_id', { length: 255 }).notNull(), // 주문 체결 ID
//     buy_order_id: varchar('buy_order_id', { length: 255 }), // 매수 주문 ID
//     sell_order_id: varchar('sell_order_id', { length: 255 }), // 매도 주문 ID
//     conditions: jsonb('conditions').default('[]'), // pr: 프리장 | re: 정규장 | po: 포스트장
// });
//
// export const ohlcvs_1s = pgTable('ohlcvs_1s', { // 시세 정보 (시가, 고가, 저가, 종가, 거래량) - 1초 봉
//     id: serial('id').primaryKey(),
//     symbol: varchar('symbol', { length: 50 }).references(() => symbols.symbol).notNull(),
//     timestamp: timestamp('timestamp').notNull(),
//     open: doublePrecision('open').notNull(),
//     high: doublePrecision('high').notNull(),
//     low: doublePrecision('low').notNull(),
//     close: doublePrecision('close').notNull(),
//     volume: doublePrecision('volume').notNull(),
// });
//
// export const userNotifies = pgTable('user_notifies', { // 사용자 알림 설정 및 이력
//     id: serial('id').primaryKey()
// }); // TODO: 추후 정의 필요