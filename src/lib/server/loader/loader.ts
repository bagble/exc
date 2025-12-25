import chokidar from 'chokidar';
import { logger } from "../../../utils/logger";
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const enum FeeType {
    Percentage = "percentage",
    Fixed = "fixed"
}

const enum weekday {
    Sunday = "Sunday",
    Monday = "Monday",
    Tuesday = "Tuesday",
    Wednesday = "Wednesday",
    Thursday = "Thursday",
    Friday = "Friday",
    Saturday = "Saturday"
}

export interface EXC {
    name: string;
    short_name: string;
    country: string;
    default_currency: string;
    default_UTC_offset: number;
    default_timezone: string;
    default_fee_type: FeeType; // "percentage": "거래 금액의 %", "fixed": "고정 수수료"
    default_fee: number; // 수수료 비율 또는 고정 수수료
    available_types: string[]; // ["index", "stocks"]
    url: string;
    logo: string; // 로고 이미지 URL
    description: string;
    pre_market_sessions: Partial<Record<weekday, { open: string; close: string; }[] | null>>, // null인 경우 프리마켓 없음 HH:MM 형식
    regular_trading_sessions: Partial<Record<weekday, { open: string; close: string; }[] | null>>, // null인 경우 정규장 없음 HH:MM 형식
    post_market_sessions: Partial<Record<weekday, { open: string; close: string; }[] | null>>, // null인 경우 애프터아워 없음 HH:MM 형식
    anniversaries: { // 기념일
        date: string; // "YYYY-MM-DD" 형식
        name: string; // 기념일 이름
        pre_market_session: { // 기념일 프리마켓 세션
            open: string; // "HH:MM" 형식
            close: string; // "HH:MM" 형식
        } | null; // null인 경우 프리마켓 없음
        regular_trading_session: { // 기념일 정규장 세션
            open: string; // "HH:MM" 형식
            close: string; // "HH:MM" 형식
        } | null; // null인 경우 정규장 없음
        post_market_session: { // 기념일 애프터아워 세션
            open: string; // "HH:MM" 형식
            close: string; // "HH:MM" 형식
        } | null; // null인 경우 애프터아워 없음
    }[] | null; // null인 경우 기념일 없음
}

/**
 * 거래소 설정 로더
 */
class Loader {
    private PJSe: EXC | null = null;
    private readonly PJSePath: string;
    private callbacks: Array<(config: EXC) => void> = [];

    constructor() {
        const possiblePaths = [
            join(process.cwd(), 'exchanges/EXC.json'),
            join(import.meta.dirname, '../../../exchanges/EXC.json'),
            join(import.meta.dirname, '../../../../exchanges/EXC.json'),
        ];

        // 존재하는 경로 찾기
        const foundPath = possiblePaths.find(p => existsSync(p));

        if (!foundPath) {
            logger.warn(`PJSe.json not found in any of these paths:`);
            possiblePaths.forEach(p => logger.warn(`  - ${p}`));
            logger.warn(`Current working directory: ${process.cwd()}`);
            logger.warn(`__dirname: ${import.meta.dirname}`);

            this.PJSePath = possiblePaths[0];
            return;
        }

        this.PJSePath = foundPath;

        this.load();
        this.watch();
    }

    private load() {
        try {
            const data = readFileSync(this.PJSePath, 'utf-8');

            if (!data || data.trim() === '') {
                logger.warn('EXC.json is empty, skipping reload');
                return;
            }

            this.PJSe = JSON.parse(data);
            this.notifyChange();
        } catch (error) {
            logger.error(`Failed to load PJSe configuration: ${error}`);
            this.PJSe = null;
        }
    }


    private watch() {
        const watcher = chokidar.watch(this.PJSePath, {
            persistent: true,
            ignoreInitial: true,
            awaitWriteFinish: {
                stabilityThreshold: 500,
                pollInterval: 100
            }
        });

        watcher.on('change', () => {
            logger.info('exchanges/EXC.json changed, reloading...');
            this.load();
        });
    }


    /**
     * 거래소 설정 Json이 변경될 때마다 호출되는 콜백 등록
     * @param callback 콜백 함수
     */
    public onChange(callback: (config: EXC) => void) {
        this.callbacks.push(callback);
    }

    private notifyChange() {
        if (this.PJSe) {
            this.callbacks.forEach(cb => cb(this.PJSe!));
        }
    }

    /**
     * 현재 로드된 거래소 설정 반환
     * @returns 거래소 설정 객체
     */
    public get(): EXC {
        if (!this.PJSe) {
            throw new Error('not loaded');
        }
        return this.PJSe;
    }

    /**
     * 현재 로드된 거래소 설정을 JSON 문자열로 반환
     * @returns {string} 거래소 설정 JSON 문자열
     */
    public getAsJson(): string {
        if (!this.PJSe) {
            throw new Error('not loaded');
        }
        return JSON.stringify(this.PJSe, null, 2);
    }
}

/**
 * 거래소 설정 로더 인스턴스
 */
export const loader = new Loader();
