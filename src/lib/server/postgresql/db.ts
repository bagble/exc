import postgres from 'postgres';
import { env } from "$env/dynamic/private";
import { logger } from "../../../utils/logger";
import { type EXC } from '../loader/loader';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';

const encodedPassword = encodeURIComponent(env.POSTGRESQL_PASSWORD);
const dbUrl = `postgres://${env.POSTGRESQL_USER}:${encodedPassword}@${env.POSTGRESQL_HOST}:${env.POSTGRESQL_PORT}/${env.POSTGRESQL_NAME}`;

const msToSec = (v?: number) => v ? Math.max(1, Math.ceil(v / 1000)) : undefined;

/**
 * PostgreSQL 클라이언트
 */
export const postgresClient = postgres(dbUrl, {
    max: Number(env.POSTGRESQL_MAX_CONNS) || 10,
    idle_timeout: msToSec(Number(env.POSTGRESQL_CONN_MAX_IDLE_TIME) || 10000),
    max_lifetime: msToSec(Number(env.POSTGRESQL_CONN_MAX_LIFETIME) || 60000),
    ssl: env.POSTGRESQL_SSL === 'disable' ? false : env.POSTGRESQL_SSL as "require" | "prefer" | "allow" | "verify-full",
});

/**
 * PostgreSQL 초기화
 */
export async function initPostgres(): Promise<void> {
    const exchange = (globalThis as any).exchange as EXC;

    try {
        await postgresClient`SELECT 1`;
        logger.info('Connected to PostgreSQL');

        await postgresClient`select set_config('TimeZone', ${exchange.default_timezone}, true)`;
        logger.info(`PostgreSQL timezone set to ${exchange.default_timezone}`);
    } catch (error) {
        logger.error('PostgreSQL connection error:', error);
        throw error;
    }
}

/**
 * Drizzle 마이그레이션 실행
 */
export async function runMigrations(): Promise<void> {
  const migrationFolder = join(process.cwd(), 'drizzle');
  
  try {
    // migrations 메타 테이블 생성
    await postgresClient`
      CREATE TABLE IF NOT EXISTS drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash TEXT NOT NULL,
        created_at BIGINT
      )
    `;

    // 마이그레이션 파일 읽기
    const files = await readdir(migrationFolder);
    const sqlFiles = files
      .filter(f => f.endsWith('.sql'))
      .sort(); // 파일명 순서대로 정렬

    for (const file of sqlFiles) {
      const filePath = join(migrationFolder, file);
      const sql = await readFile(filePath, 'utf-8');
      
      // 이미 실행된 마이그레이션인지 확인
      const [existing] = await postgresClient`
        SELECT id FROM drizzle_migrations WHERE hash = ${file}
      `;

      if (!existing) {
        logger.info(`Running migration: ${file}`);
        
        // 트랜잭션으로 실행
        await postgresClient.begin(async (tx) => {
          // SQL 실행
          await tx.unsafe(sql);
          
          // 실행 기록 저장
          await tx`
            INSERT INTO drizzle_migrations (hash, created_at)
            VALUES (${file}, ${Date.now()})
          `;
        });
        
        logger.info(`Migration completed: ${file}`);
      } else {
        logger.debug(`Migration already applied: ${file}`);
      }
    }

    logger.info('All migrations completed successfully');
  } catch (error) {
    logger.error('Migration error:', error);
    throw error;
  }
}

/**
 * PostgreSQL 연결 테스트
 */
export async function pingPostgres(): Promise<boolean> {
    try {
        await postgresClient`SELECT 1`;
        return true;
    } catch (error) {
        logger.error('PostgreSQL ping error:', error);
        return false;
    }
}

/**
 * PostgreSQL 연결 종료
 */
export async function closePostgres(): Promise<void> {
    try {
        await postgresClient.end({timeout: 5});
        logger.info('PostgreSQL connection closed');
    } catch (e) {
        logger.error('PostgreSQL close error:', e);
    }
}