<script lang="ts">
    const {data} = $props<{ data: { userName: any, admin: boolean } }>();
</script>

<!--헤더-->
<div class="select-none p-2">
    {#if data.userName}
       <div class="flex items-center justify-between">
           <div class="flex-1"></div>
           <h1 class="text-3xl font-bold text-center select-none flex-1 whitespace-nowrap">Welcome, {data.userName}!</h1>
           <div class="flex justify-end select-none flex-1">
               <a href="/" class="mr-2 text-blue-600 underline">Home</a>
               <a href="/settings" class="mr-2 text-blue-600 underline">Settings</a>
               {#if data.admin}
                   <a href="/admin" class="mr-2 text-blue-600 underline">Admin Panel</a>
               {/if}
               <a href="/auth/logout" class="mr-2 text-blue-600 underline">Logout</a>
           </div>
       </div>
    {:else}
        <div class="flex items-center justify-end">
            <div class="flex-1"></div>
            <h1 class="text-3xl font-bold text-center select-none flex-1 whitespace-nowrap">Welcome, Guest!</h1>
            <div class="flex justify-end select-none flex-1">
                <a href="/" class="mr-2 text-blue-600 underline">Home</a>
                <a href="/auth" class="mr-2 text-blue-600 underline">Login / Sign Up</a>
            </div>
        </div>
    {/if}
</div>

{#if data.userName}
    <div>
        <a href="/test" class="text-blue-600 underline">Test</a>
        <a href="/test/depth" class="ml-4 text-blue-600 underline">Depth</a>
        <a href="/test/ledger" class="ml-4 text-blue-600 underline">Ledger</a>
        <a href="/test/order" class="ml-4 text-blue-600 underline">Order</a>
        <a href="/test/chart?interval=1s" class="ml-4 text-blue-600 underline">Chart (1s)</a>
        <a href="/test/chart?interval=1m" class="ml-4 text-blue-600 underline">Chart (1m)</a>
        <a href="/test/chart?interval=5m" class="ml-4 text-blue-600 underline">Chart (5m)</a>
        <a href="/test/chart?interval=15m" class="ml-4 text-blue-600 underline">Chart (15m)</a>
        <a href="/test/chart?interval=30m" class="ml-4 text-blue-600 underline">Chart (30m)</a>
        <a href="/test/chart?interval=1h" class="ml-4 text-blue-600 underline">Chart (1h)</a>
        <a href="/test/chart?interval=4h" class="ml-4 text-blue-600 underline">Chart (4h)</a>
        <a href="/test/chart?interval=1D" class="ml-4 text-blue-600 underline">Chart (1D)</a>
        <a href="/test/chart?interval=1W" class="ml-4 text-blue-600 underline">Chart (1W)</a>
        <a href="/test/chart?interval=1M" class="ml-4 text-blue-600 underline">Chart (1M)</a>
        <a href="/test/chart?interval=1Y" class="ml-4 text-blue-600 underline">Chart (1Y)</a>
    </div>
{/if}