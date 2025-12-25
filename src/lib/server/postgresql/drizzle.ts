import { drizzle } from 'drizzle-orm/postgres-js';
import * as schemas from './schemas';
import { postgresClient } from "$lib/server/postgresql/db";

/**
 * Drizzle ORM
 */
export const orm = drizzle(postgresClient, {
    schema: schemas,
});

/**
 * PostgreSQL에 정의된 모든 스키마
 */
export { schemas };