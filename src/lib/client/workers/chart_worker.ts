import { SSEConnection } from "$lib/client/workers/sse_connection";

let sseConnection: SSEConnection | null = null;

self.addEventListener('message', function (event) {
    const data = event.data;

    if (data.type === 'connect') {
        const {
            symbol,
            interval,
            partial_book = false,
            session = true,
            info = true,
            depth = true,
            ledger = true,
            chart = true
        } = event.data;

        if (!symbol || !interval) {
            self.postMessage({ type: 'error', message: 'Invalid symbol or interval' });
            return;
        }

        const params = new URLSearchParams({
            interval,
            partial_book: partial_book.toString(),
            session: session.toString(),
            info: info.toString(),
            depth: depth.toString(),
            ledger: ledger.toString(),
            chart: chart.toString()
        });

        // 이벤트 목록 동적 생성
        const events = [];
        if (session) events.push('session');
        if (info) events.push('info');
        if (depth) events.push('depth');
        if (ledger) events.push('ledger');
        if (chart) events.push('chart');

        sseConnection = new SSEConnection({
            url: `/api/sse/data/${symbol}?${params.toString()}`,
            events: events,
            maxReconnectAttempts: 10
        });

        self.postMessage({ type: 'connectionState', state: 'connecting' });
        sseConnection.connect();
    }

    if (data.type === 'disconnect') {
        sseConnection?.disconnect();
    }
});
