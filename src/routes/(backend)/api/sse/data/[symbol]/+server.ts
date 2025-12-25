import { produce } from 'sveltekit-sse';
import { addDataClient, removeDataClient } from "$lib/server/sse";
import { getServerORPC } from "$lib/server/rpc/orpc.server";
import { logger } from "../../../../../../utils/logger";
import { session } from "$lib/server/loader/EXC";
import { getDepth } from "$lib/server/redis/presets/depth";
import { getLedger } from "$lib/server/redis/presets/ledger";
import { getChartTop } from "$lib/server/redis/presets/chart";
import { getSupportedIntervals } from "../../../../../../utils/timestamp";
import { TimeService } from "$lib/server/redis/time";
import { env } from "$env/dynamic/private";

export function GET({params: {symbol}, url, getClientAddress, request}) {
    return produce(
        async function start({emit}) {
            const ip = env.CLOUDFLARED_TUNNEL ? request.headers.get('CF-Connecting-IP') || getClientAddress() : getClientAddress();
            const sessionId = crypto.randomUUID();
            const interval = url.searchParams.get('interval') || '1m'; // 기본값 1분
            const partial_book = url.searchParams.get('partial_book') === 'true'; // 기본값 false
            const allowed = {
                info: url.searchParams.get('info') === null ? true : url.searchParams.get('info') === 'true',
                session: url.searchParams.get('session') === null ? true : url.searchParams.get('session') === 'true',
                depth: url.searchParams.get('depth') === null ? true : url.searchParams.get('depth') === 'true',
                ledger: url.searchParams.get('ledger') === null ? true : url.searchParams.get('ledger') === 'true',
                chart: url.searchParams.get('chart') === null ? true : url.searchParams.get('chart') === 'true',
            }; // 기본값 모두 true
            if (!sessionId) {
                return function stop() {
                    logger.error('Data: Missing session-id header.');
                };
            }

            let symbolData;
            try {
                symbolData = await getServerORPC().symbols.get({
                    symbol: symbol
                })
            } catch (e) {
                return function stop() {
                    logger.error(`Data: Client disconnected due to symbol fetch error: ${sessionId} for symbol: ${symbol} -> ${e}`);
                }
            }
            if (symbolData !== null) {
                try {
                    addDataClient(symbol, {emit, sessionID: sessionId}, {
                        interval,
                        partial_book,
                        info: allowed.info,
                        session: allowed.session,
                        depth: allowed.depth,
                        ledger: allowed.ledger,
                        chart: allowed.chart
                    });

                    // 초기 연결 시 메시지 전송
                    emit('connected', JSON.stringify({
                        message: 'Connected to SSE',
                        sessionId,
                        symbol
                    }));

                    if (allowed.info) { // 심볼 정보 전송
                        emit('info', JSON.stringify(symbolData));
                    }

                    if (allowed.session && session.session !== "") { // 세션 정보 전송
                        emit('session', JSON.stringify({session: session.session}));
                    }

                    // 과거 데이터 전송
                    if (allowed.depth) { // 호가 데이터 전송
                        let depthData;
                        if (partial_book) {
                            depthData = await getDepth(symbol, 15); // 최대 15 레벨의 호가 데이터 가져오기 (스냅샷(init)용)
                        } else {
                            depthData = await getDepth(symbol, 1000); // 최대 1000 레벨의 호가 데이터 가져오기 (스냅샷(init)용)
                        }
                        emit('depth', JSON.stringify({
                            type: "init",
                            ...depthData ?? {updateId: null, depth: {bids: [], asks: []}}
                        }));
                    }

                    if (allowed.ledger) { // 체결 데이터 전송
                        const ledgerData = (await getLedger(symbol, 100)); // 최대 100개의 체결 데이터 가져오기 (스냅샷(init)용)
                        emit('ledger', JSON.stringify({
                            type: "init",
                            ledger: ledgerData ?? []
                        }));
                    }

                    if (allowed.chart) { // 차트 데이터 전송
                        if (getSupportedIntervals(0).includes(interval)) {
                            const lastUpdate = await TimeService.now();
                            const chartData = await getChartTop(symbol, interval, lastUpdate, 100, { type: "fill", endTimestamp: lastUpdate }); // 최대 100개의 차트 데이터 가져오기 (스냅샷(init)용)
                            emit('chart', JSON.stringify({
                                type: "init",
                                interval: interval,
                                chart: chartData ?? []
                            }));
                        } else {
                            emit('error', JSON.stringify({error: `Invalid interval: ${interval}`}));
                        }
                    }

                    logger.info(`Data: Client connected: ${sessionId}|${ip} for symbol: ${symbol} with interval: ${interval} -> partial_book: ${partial_book}, allowed: ${JSON.stringify(allowed)}`);

                    return function cleanup() {
                        // 클라이언트 연결 해제 시 정리
                        removeDataClient(symbol, {emit, sessionID: sessionId});
                        logger.info(`Data: Client disconnected: ${sessionId}|${ip} for symbol: ${symbol}`);
                    };
                } catch (e) {
                    logger.error(`Data: SSE connection error: ${e}`);
                    return function stop() {
                        logger.error(`Data: SSE connection cleanup after error: ${sessionId}|${ip} for symbol: ${symbol}`)
                    };
                }
            } else {
                emit('error', JSON.stringify({error: `Invalid symbol: ${symbol}`}));
                return function stop() {
                    logger.error(`Data: Client disconnected due to invalid symbol: ${sessionId}|${ip} for symbol: ${symbol}`);
                };
            }
        },
        {
            ping: 30000, // send a ping every 30 seconds
            stop() {
                logger.info('Data: SSE connection stopped by the server.');
            }
        }
    );
}