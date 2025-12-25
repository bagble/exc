import {z} from "zod";

const PortfolioDefaultSchema = z.object({
    id: z.int(),
    user_id: z.int(),
    name: z.string().max(50),
    detail: z.string().nullable(),
    password: z.string(), // 해시된 비밀번호
    createdAt: z.date(),
    updatedAt: z.date(),
    balance: z.number().default(0),
    holdings: z.array(z.object({
        symbol: z.string(),
        quantity: z.number(),
        avg_price: z.number()
    })).default([]),
});

const PortfolioHistoryDefaultSchema = z.object({
    id: z.int(),
    portfolio_id: z.int(),
    timestamp: z.date().default(new Date()),
    type: z.enum(['deposit', 'withdraw', 'buy', 'sell', 'dividend', 'fee', 'adjustment']),
    changes: z.array(z.object({
        balance: z.number().optional(),
        balance_change: z.number().optional(),
        symbol: z.string().optional(),
        quantity: z.number().optional(),
        price: z.number().nullable().optional(),
        avg_price: z.number().nullable().optional(),
    })).default([]),
});