<script lang="ts">
    import {writable} from "svelte/store";
    import { onMount } from "svelte";

    const depthSnapshot = writable<any>({ bids: [], asks: [] }); // 초기값 설정
    const depth = writable<any>({ bids: [], asks: [] }); // 실시간 업데이트용

    let loaded = $state(false);

    let worker: Worker;

    onMount(() => {
        worker = new Worker(new URL('$lib/client/workers/chart_worker.ts', import.meta.url), {
            type: 'module',
            name: 'Chart Worker'
        });
        worker.postMessage({
            type: 'connect',
            symbol: 'EXC',
            interval: '1m',
            session: false,
            info: false,
            depth: true,
            ledger: false,
            chart: false
        });

        worker.onmessage = (event) => {
            if (event.data.type === 'depth') {
                const parsed = event.data.data;
                console.log('depth data received:', parsed);

                if (parsed.type === "init") {
                    depthSnapshot.set({ bids: parsed.depth.bids, asks: parsed.depth.asks });

                    // depthSnapshot의 데이터를 최대 25개로 제한
                    const slidedBids = Array.isArray(parsed.depth.bids) ? parsed.depth.bids.slice(0, 25) : [];
                    const slidedAsks = Array.isArray(parsed.depth.asks) ? parsed.depth.asks.slice(0, 25) : [];

                    depth.set({ bids: slidedBids, asks: slidedAsks }); // 최대 25개로 제한

                    loaded = true;
                } else if (parsed.type === "update") {
                    depthSnapshot.update(current => {
                        const updatedBids = [...current.bids];
                        const updatedAsks = [...current.asks];

                        // bids 업데이트
                        parsed.depth.bids?.forEach(([price, size]: [number, number]) => {
                            const index = updatedBids.findIndex((b: [number, number]) => b[0] === price);
                            if (size === 0) {
                                if (index !== -1) updatedBids.splice(index, 1);
                            } else {
                                if (index !== -1) {
                                    updatedBids[index] = [price, size];
                                } else {
                                    updatedBids.push([price, size]);
                                }
                            }
                        });

                        // asks 업데이트
                        parsed.depth.asks?.forEach(([price, size]: [number, number]) => {
                            const index = updatedAsks.findIndex((a: [number, number]) => a[0] === price);
                            if (size === 0) {
                                if (index !== -1) updatedAsks.splice(index, 1);
                            } else {
                                if (index !== -1) {
                                    updatedAsks[index] = [price, size];
                                } else {
                                    updatedAsks.push([price, size]);
                                }
                            }
                        });

                        // 가격 기준으로 정렬
                        updatedBids.sort((a: [number, number], b: [number, number]) => b[0] - a[0]); // 내림차순
                        updatedAsks.sort((a: [number, number], b: [number, number]) => a[0] - b[0]); // 오름차순

                        // depthSnapshot의 데이터를 최대 25개로 제한
                        const slidedBids = Array.isArray(updatedBids) ? updatedBids.slice(0, 25) : [];
                        const slidedAsks = Array.isArray(updatedAsks) ? updatedAsks.slice(0, 25) : [];

                        depth.set({ bids: slidedBids, asks: slidedAsks }); // 최대 25개로 제한

                        return { bids: updatedBids, asks: updatedAsks };
                    });
                }
            }
        };

        return () => {
            worker.postMessage({type: 'disconnect'});
            worker.terminate();
        };
    });
</script>

<table>
    <thead>
    <tr class="no_interaction">
        <th style="border-right: 1px solid #eee; border-left: 1px solid #eee; padding: 8px;">Ask Size</th>
        <th style="border-right: 1px solid #eee; padding: 8px;">Price</th>
        <th style="border-right: 1px solid #eee; padding: 8px;">Bid Size</th>
    </tr>
    </thead>
    {#if loaded}
        <tbody>
        {#if $depth.bids?.length > 0 || $depth.asks?.length > 0}
            {#each [
                ...($depth.asks ?? []).map((a: [number, number]) => a[0]).reverse(),
                ...($depth.bids ?? []).map((b: [number, number]) => b[0])
            ] as price}
                <tr class="no_interaction">
                    <td style="border-bottom: 1px solid #eee; border-left: 1px solid #eee; padding: 8px; position: relative;">
                        {#if $depth.asks}
                            {@const maxAsk = Math.max(...($depth.asks ?? []).map((a: [number, number]) => a[1]), 1)}
                            <div style="background: rgba(30,30,255,0.5); height: 16px; width: {Math.min(100, (($depth.asks.find((a: [number, number]) => a[0] === price)?.[1] ?? 0) / maxAsk) * 100)}px; position: absolute; right: 0; top: 50%; transform: translateY(-50%); opacity: 0.5;"></div>
                        {/if}
                        <span style="position: absolute; right: 8px; top: 50%; transform: translateY(-50%)">{($depth.asks?.find((a: [number, number]) => a[0] === price)?.[1] ?? '')}</span>
                    </td>
                    <td style="border-bottom: 1px solid #eee; border-right: 1px solid #eee; border-left: 1px solid #eee; padding: 8px; text-align: center;">
                        <button style="background: none; border: none; color: inherit; font: inherit; cursor: pointer; outline: inherit; width: 100%; height: 100%;" onclick={() => {
                       // const quantity = (
                       //     ($depth.asks?.find((a: [number, number]) => a[0] === price)
                       //         ? ($depth.asks ?? []).filter((a: [number, number]) => a[0] <= price).reduce((sum: number, a: [number, number]) => sum + a[1], 0)
                       //         : ($depth.bids ?? []).filter((b: [number, number]) => b[0] <= price).reduce((sum: number, b: [number, number]) => sum + b[1], 0))
                       // );

                        // order.update(o => ({
                        // ...o,
                        //  action: 'Create',
                        //   side: ($depth.bids?.find((b: [number, number]) => b[0] === price) ? 'sell' : 'buy'),
                        //    type: 'limit',
                        //     price: price,
                        //      quantity: quantity
                        // }));

                    }}>
                            {price}원
                        </button>
                    </td>
                    <td style="border-bottom: 1px solid #eee; border-right: 1px solid #eee; padding: 8px; position: relative;">
                        {#if $depth.bids}
                            {@const maxBid = Math.max(...($depth.bids ?? []).map((b: [number, number]) => b[1]), 1)}
                            <div style="background: rgba(255,30,30,0.5); height: 16px; width: {Math.min(100, (($depth.bids.find((b: [number, number]) => b[0] === price)?.[1] ?? 0) / maxBid) * 100)}px; position: absolute; left: 0; top: 50%; transform: translateY(-50%); opacity: 0.5;"></div>
                        {/if}
                        <span style="position: absolute; top: 50%; transform: translateY(-50%);">{($depth.bids?.find((b: [number, number]) => b[0] === price)?.[1] ?? '')}</span>
                    </td>
                </tr>
            {/each}
        {:else}
            <tr class="no_interaction">
                <td colspan="3" style="border-bottom: 1px solid #eee; border-right: 1px solid #eee; border-left: 1px solid #eee; padding: 8px; text-align: center;">No depth data available</td>
            </tr>
        {/if}
        </tbody>
    {/if}
</table>

<style>
    .no_interaction {
        pointer-events: none;
        user-select: none;
    }

    .no_interaction button {
        pointer-events: auto;
        user-select: auto;
    }

    table {
        width: 100%;
        border-collapse: separate;
        border-spacing: 0;
    }

    thead th {
        position: sticky;
        top: 0;
        z-index: 2;
        background: #fff;
        box-shadow: inset 0 -1px 0 #ccc, inset 0 1px 0 #eee;
    }
</style>