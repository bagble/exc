import type { Config } from 'drizzle-kit';

const encodedPassword = encodeURIComponent(process.env.POSTGRESQL_PASSWORD!);
const dbUrl = `postgres://${process.env.POSTGRESQL_USER}:${encodedPassword}@${process.env.POSTGRESQL_HOST}:${process.env.POSTGRESQL_PORT}/${process.env.POSTGRESQL_NAME}?sslmode=${process.env.POSTGRESQL_SSL === 'disable' ? 'disable' : process.env.POSTGRESQL_SSL}`;

export default {
    schema: 'src/lib/server/postgresql/schemas.ts',
    out: './drizzle',
    dialect: 'postgresql',
    dbCredentials: {
        url: dbUrl,
    },
    verbose: true,
    strict: true,
} satisfies Config;