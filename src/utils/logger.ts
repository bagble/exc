import winston from 'winston';
import 'winston-daily-rotate-file';
import * as fs from "node:fs";
import { env } from '$env/dynamic/private';

const enableLog = process.env.SYS_LOG === 'true' || (env.SYS_LOG === 'true' || true);
const logDir = process.env.SYS_LOG_LOCATION || (env.SYS_LOG_LOCATION || './logs');
const logStdout = process.env.SYS_LOG_STDOUT === 'true' || (env.SYS_LOG_STDOUT === 'true' || false);

if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

const stripAnsi = (str: string): string => {
    return str.replace(/\u001b\[[0-9;]*m/g, '');
};

const formatMessage = winston.format.combine(
    winston.format.uncolorize(),
    winston.format.printf(({ timestamp, level, message, stack }) => {
        const logMsg = stack ? String(stack) : String(message || '');
        const cleanMsg = stripAnsi(logMsg)
            .replace(/[\r\n]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        return cleanMsg ? `[${timestamp}] [${level}]: ${cleanMsg}` : '';
    })
)

const logger = winston.createLogger({
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:SSS' }),
        winston.format.errors({ stack: true })
    ),
    transports: enableLog ? [
        new winston.transports.DailyRotateFile({
            filename: 'info-%DATE%.log',
            datePattern: 'YYMMDD',
            dirname: logDir,
            level: 'info',
            zippedArchive: true,
            format: formatMessage
        }),
        new winston.transports.DailyRotateFile({
            filename: 'error-%DATE%.log',
            datePattern: 'YYMMDD',
            dirname: logDir,
            level: 'error',
            format: formatMessage
        })
    ] : []
});

if (logStdout && enableLog) {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize({ all: true }),
            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:SSS' }),
            winston.format.printf(({ timestamp, level, message, stack }) => {
                const logMsg = stack ? stack : message;
                return `[${timestamp}] [${level}]: ${logMsg}`;
            })
        )
    }));
}

const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

console.log = (...args) => {
    if (enableLog) logger.info(args.join(' '));
    else originalLog(...args);
};

console.error = (...args) => {
    if (enableLog) logger.error(args.join(' '));
    else originalError(...args);
};

console.warn = (...args) => {
    if (enableLog) logger.warn(args.join(' '));
    else originalWarn(...args);
};

export { logger };