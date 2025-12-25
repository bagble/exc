<script lang="ts">
    import {safe} from "@orpc/client";
    import { rpc } from '$lib/client/rpc'
    import {onMount} from "svelte";

    const { data } = $props<{ data: { exchange: any, user: any } }>();

    let listSymbols: any = $state(null);
    let listUsers : any = $state(null);
    let isLoading = $state(false);

    onMount(async () => {
        isLoading = true;
        const { data: symbolsData } = await safe(rpc.symbols.getAllAdmin({
            page: 1,
            pageSize: 100,
        }));
        listSymbols = symbolsData;

        const { data: usersData } = await safe(rpc.users.getAll({
            page: 1,
            pageSize: 100,
        }));
        listUsers = usersData;

        isLoading = false;
    })

    let processing = $state(false);
    let result: any = $state(null);
    async function test() {
        processing = true;
        const { data, error } = await safe(
            rpc.symbols.listing({
                symbol: "EXC",
                name: "(주) EXC",
                detail: "예시 상장 기업입니다.",
                url: "https://example.com",
                logo: "https://example.com/logo.png",
                market: "EXC",
                type: "stock",
                minimum_order_quantity: 1,
                tick_size: 1,
                total_shares: 100000,
                ipo_price: 12500,
            })
            // rpc.users.getProfile()
        );
        result = { data, error };
        processing = false;
    }

    let activating = $state(false);
    let activateResult: any = $state(null);
    async function activateEXC() {
        activating = true;
        activateResult = null;
        const { data, error } = await safe(rpc.symbols.updateStatus({
            symbol: 'EXC',
            status: { status: 'active' }
        }));

        activateResult = { data, error };

        // refresh list
        const { data: symbolsData } = await safe(rpc.symbols.getAllAdmin({ page: 1, pageSize: 100 }));
        listSymbols = symbolsData;

        activating = false;
    }
</script>

<details class="mt-6 p-4 border rounded w-max">
    <summary class="inline-block cursor-pointer select-none font-bold">EXC</summary>
    <div>
        <h2 class="text-lg mt-4">EXC Details</h2>
        <pre class="bg-gray-100 p-4 rounded overflow-x-auto"><code>{JSON.stringify(data.exchange, null, 2)}</code></pre>
    </div>
</details>


<details class="mt-6 p-4 border rounded w-max">
    <summary class="inline-block cursor-pointer select-none font-bold">Symbols List</summary>
    {#if !isLoading}
        <div>
            <h2 class="text-lg mt-4">Symbols Details</h2>
            <pre class="bg-gray-100 p-4 rounded overflow-x-auto"><code>{JSON.stringify(listSymbols, null, 2)}</code></pre>
        </div>
    {:else}
        <p>Loading symbols...</p>
    {/if}
</details>

<details class="mt-6 p-4 border rounded w-max">
    <summary class="inline-block cursor-pointer select-none font-bold">Users List</summary>
    {#if !isLoading}
        <div>
            <h2 class="text-lg mt-4">Users Details</h2>
            <pre class="bg-gray-100 p-4 rounded overflow-x-auto"><code>{JSON.stringify(listUsers, null, 2)}</code></pre>
        </div>
    {:else}
        <p>Loading users...</p>
    {/if}
</details>

<button onclick={test} disabled={processing}>
    {processing ? '처리 중...' : 'Test Button'}
</button>

<button class="px-3 py-1 bg-blue-600 text-white rounded" onclick={activateEXC} disabled={activating}>
    {activating ? 'Activating...' : 'Activate EXC'}
</button>
{#if activateResult}
    {#if activateResult.error}
        <div class="text-red-600 mt-2">Error: {activateResult.error.message || JSON.stringify(activateResult.error)}</div>
    {:else}
        <div class="text-green-600 mt-2">Activated: {activateResult.data?.symbol}</div>
    {/if}
{/if}

{#if processing}
    <p>Loading...</p>
{:else if result?.error}
    <p>Error: {result.error}</p>
    <pre class="bg-red-100 p-4 rounded overflow-x-auto"><code>{JSON.stringify(result.error, null, 2)}</code></pre>
{:else if result?.data}
    <h3 class="text-lg font-bold mt-4">Symbol Created Successfully:</h3>
    <pre class="bg-green-100 p-4 rounded overflow-x-auto"><code>{JSON.stringify(result.data, null, 2)}</code></pre>
{/if}