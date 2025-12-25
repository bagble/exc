<script lang="ts">
    import {onMount} from "svelte";
    import {writable} from "svelte/store";

    const dataConnectionState = writable<'connected' | 'connecting' | 'disconnected'>('connecting');
    const sessionMessage = writable<any>({});
    const infoMessage = writable<any>({});
    const depthMessage = writable<any>({});
    const ledgerMessage = writable<any>({});
    const chartMessage = writable<any>({});
    const error = writable<string | null>(null);

    const notifyConnectionState = writable<'connected' | 'connecting' | 'disconnected'>('connecting');
    const orderNotifyMessage = writable<any>({});

    let worker: Worker;
    let notifyWorker: SharedWorker;

    onMount(() => {
        worker = new Worker(new URL('$lib/client/workers/chart_worker.ts', import.meta.url), {
            type: 'module',
            name: 'Chart Worker'
        });
        worker.postMessage({
            type: 'connect',
            symbol: 'EXC',
            interval: '1m',
            chart: true
        });

        worker.onmessage = (event) => {
            if (event.data.type === 'connectionState') {
                dataConnectionState.set(event.data.data);
            } else if (event.data.type === 'session') {
                sessionMessage.set(event.data.data);
            } else if (event.data.type === 'info') {
                infoMessage.set(event.data.data);
            } else if (event.data.type === 'depth') {
                depthMessage.set(event.data.data);
            } else if (event.data.type === 'ledger') {
                ledgerMessage.set(event.data.data);
            } else if (event.data.type === 'chart') {
                chartMessage.set(event.data.data);
            }
        };

        worker.onerror = (event) => {
            // console.error('Chart Worker Error:', event.message);
            error.set(event.message);
        };

        notifyWorker = new SharedWorker(new URL('$lib/client/workers/notify_worker.ts', import.meta.url), {
            type: 'module',
            name: 'Notify Worker'
        });
        notifyWorker.port.start();
        notifyWorker.port.postMessage({type: 'connect'});

        notifyWorker.port.onmessage = (event) => {
            if (event.data.type === 'connectionState') {
                notifyConnectionState.set(event.data.data);
            } else if (event.data.type === 'order') {
                orderNotifyMessage.set(event.data.data);
            }
        };

        notifyWorker.onerror = (event) => {
            // console.error('Notify Worker Error:', event.message);
            error.set(event.message);
        };

        return () => {
            worker.postMessage({type: 'disconnect'});
            worker.terminate();

            notifyWorker.port.postMessage({type: 'disconnect'});
            notifyWorker.port.close();
        };
    });
</script>

<main>
    <h1 class="text-3xl font-bold text-center select-none flex-1 whitespace-nowrap">SSE 실시간 데이터 테스트 (EXC)</h1>

    <div class="status">
        <h2>연결 상태:</h2>
        <p>Data: {#if $dataConnectionState === 'connected'}
            <span style="color: green;">연결됨</span>
        {:else if $dataConnectionState === 'connecting'}
            <span style="color: orange;">연결 중...</span>
        {:else}
            <span style="color: red;">연결 끊김</span>
        {/if}</p>
        <p>Notify: {#if $notifyConnectionState === 'connected'}
            <span style="color: green;">연결됨</span>
        {:else if $notifyConnectionState === 'connecting'}
            <span style="color: orange;">연결 중...</span>
        {:else}
            <span style="color: red;">연결 끊김</span>
        {/if}</p>
        {#if $error}
            <p style="color: red;">에러: {$error}</p>
        {/if}
    </div>

    <div class="data">
        <h2>실시간 데이터:</h2>
        <details>
            <summary>주문 알림 (Order Notify)</summary>
            <pre>{JSON.stringify($orderNotifyMessage, null, 2)}</pre>
        </details>
        <details>
            <summary>세션 (Session)</summary>
            <pre>{JSON.stringify($sessionMessage, null, 2)}</pre>
        </details>
        <details>
            <summary>정보 (Info)</summary>
            <pre>{JSON.stringify($infoMessage, null, 2)}</pre>
        </details>
        <details>
            <summary>호가 (Depth)</summary>
            <pre>{JSON.stringify($depthMessage, null, 2)}</pre>
        </details>
        <details>
            <summary>원장 (Ledger)</summary>
            <pre>{JSON.stringify($ledgerMessage, null, 2)}</pre>
        </details>
        <details>
            <summary>차트 (Chart 60)</summary>
            <pre>{JSON.stringify($chartMessage, null, 2)}</pre>
        </details>
    </div>
</main>

<style>
    .status, .data {
        margin: 1rem 0;
        padding: 1rem;
        border: 1px solid #ccc;
        border-radius: 4px;
    }

    pre {
        background: #f5f5f5;
        padding: 1rem;
        border-radius: 4px;
        overflow: auto;
    }
</style>