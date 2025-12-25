<script lang="ts">
    import {writable} from "svelte/store";
    import { onMount } from "svelte";

    const ledger = writable<any>([]);
    const ledgerBuffer = new Map();
    let seq = 0;

    const BUFFER_SIZE = 500;
    const MAX_LEDGER_SIZE = 100;

    let loaded = $state(false);

    const timestampFormat = (entry: any) => new Date(entry.timestamp).toLocaleTimeString('ko-KR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });

    let worker: Worker;

    let updateQueue: any[] = [];
    let rafId: number | null = null;

    const flushUpdates = () => {
        if (updateQueue.length === 0) return;

        ledger.update(current => {
            const newEntries = updateQueue.reverse();
            const remaining = current.slice(0, MAX_LEDGER_SIZE - newEntries.length);
            return [...newEntries, ...remaining];
        });

        updateQueue = [];
        rafId = null;
    };

    const batchUpdate = (entry: any) => {
        updateQueue.push(entry);

        if (!rafId) {
            rafId = requestAnimationFrame(flushUpdates);
        }
    };

    onMount(() => {
        worker = new Worker(new URL('$lib/client/workers/chart_worker.ts', import.meta.url), {
            type: 'module',
            name: 'Chart Worker'
        });

        worker.postMessage({
            type: 'connect',
            symbol: 'EXC',
            interval: '1m',
            partial_book: true,
            session: false,
            info: false,
            depth: false,
            ledger: true,
            chart: false
        });

        worker.onmessage = (event) => {
            if (event.data.type === 'ledger') {
                const parsed = event.data.data;
                console.log('Ledger data received:', parsed);

                if (parsed.type === "init") {
                    ledger.set(parsed.ledger);
                    loaded = true;
                    seq = (parsed.ledger[0]?.sequence ?? 0) + 1;
                } else if (parsed.type === "update") {
                    for (const entry of parsed.ledger) {
                        ledgerBuffer.set(entry.sequence, entry);
                    }

                    while (ledgerBuffer.has(seq)) {
                        const entry = ledgerBuffer.get(seq);
                        batchUpdate(entry);
                        ledgerBuffer.delete(seq);
                        seq++;
                    }

                    if (ledgerBuffer.size > BUFFER_SIZE) {
                        const firstKey = ledgerBuffer.keys().next().value;
                        if (firstKey !== undefined) {
                            ledgerBuffer.delete(firstKey);
                        }
                    }
                }
            }
        };

        return () => {
            if (rafId) {
                cancelAnimationFrame(rafId);
            }
            worker.postMessage({type: 'disconnect'});
            worker.terminate();
        };
    });

    let showToday = $state(true);

    function switchView() {
        showToday = !showToday;
    }
</script>

<button onclick={switchView}>Switch View (Today / All)</button>

{#if showToday}
    <table>
        <thead>
        <tr class="no_interaction">
            <th style="border-right: 1px solid #eee; border-left: 1px solid #eee; padding: 8px;">Timestamp</th>
            <th style="border-right: 1px solid #eee; padding: 8px;">Price</th>
            <th style="border-right: 1px solid #eee; padding: 8px;">Change</th>
            <th style="border-right: 1px solid #eee; padding: 8px;">Volume</th>
            <th style="border-right: 1px solid #eee; padding: 8px;">Cumulative Volume</th>
        </tr>
        </thead>
        {#if loaded}
            <tbody>
            {#if $ledger?.length > 0}
                {#each $ledger as entry (entry.sequence)}
                    <tr>
                        <td style="border-bottom: 1px solid #eee; border-right: 1px solid #eee; padding: 8px;">
                            {timestampFormat(entry)}
                        </td>
                        <td style="border-bottom: 1px solid #eee; border-right: 1px solid #eee; padding: 8px;">
                            {entry.price?.toLocaleString('ko-KR', { style: 'currency', currency: 'KRW' })}
                        </td>
                        <td style="border-bottom: 1px solid #eee; border-right: 1px solid #eee; padding: 8px;">
                            {entry.change >= 0 ? '+' : ''}{entry.change}%
                        </td>
                        <td style="border-bottom: 1px solid #eee; border-right: 1px solid #eee; padding: 8px;">
                            {entry.volume}
                        </td>
                        <td style="border-bottom: 1px solid #eee; padding: 8px;">
                            {entry.cumulativeVolume}
                        </td>
                    </tr>
                {/each}
            {:else}
                <tr class="no_interaction">
                    <td colspan="5" style="border-bottom: 1px solid #eee; border-right: 1px solid #eee; border-left: 1px solid #eee; padding: 8px; text-align: center;">
                        No ledger data available
                    </td>
                </tr>
            {/if}
            </tbody>
        {/if}
    </table>
{:else}
    <table>
        <thead>
        <tr class="no_interaction">
            <th style="border-right: 1px solid #eee; border-left: 1px solid #eee; padding: 8px;">Timestamp</th>
            <th style="border-right: 1px solid #eee; padding: 8px;">Change</th>
            <th style="border-right: 1px solid #eee; padding: 8px;">Open</th>
            <th style="border-right: 1px solid #eee; padding: 8px;">High</th>
            <th style="border-right: 1px solid #eee; padding: 8px;">Low</th>
            <th style="border-right: 1px solid #eee; padding: 8px;">Close</th>
            <th style="border-right: 1px solid #eee; padding: 8px;">Volume</th>
            <th style="border-right: 1px solid #eee; padding: 8px;">Volume(￦)</th>
        </tr>
        </thead>
        <tbody>
        <tr class="no_interaction">
            <td colspan="8" style="border-bottom: 1px solid #eee; border-right: 1px solid #eee; border-left: 1px solid #eee; padding: 8px; text-align: center;">
                No ledger data available
            </td>
        </tr>
        </tbody>
    </table>
{/if}

<style>
    .no_interaction {
        pointer-events: none;
        user-select: none;
    }

    table {
        width: 100%;
        border-collapse: separate;
        border-spacing: 0;
        overflow-anchor: none;
    }

    thead th {
        position: sticky;
        top: 0;
        z-index: 2;
        background: #fff;
        box-shadow: inset 0 -1px 0 #ccc, inset 0 1px 0 #eee;
    }
</style>