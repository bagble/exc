<script lang="ts">
    import type {Snippet} from "svelte";

    let { children, data }: {
        children: Snippet;
        data: { user: any }
    } = $props();
</script>

{#if data.user?.admin}
    <!--헤더-->
    <div class="select-none p-2">
        <div class="flex items-center justify-between">
            <div class="flex-1"></div>
            <h1 class="text-3xl font-bold text-center select-none flex-1 whitespace-nowrap">Welcome, {data.user?.name}! This is the admin page.</h1>
            <div class="flex justify-end select-none flex-1">
                <a href="/" class="mr-2 text-blue-600 underline">Home</a>
                <a href="/settings" class="mr-2 text-blue-600 underline">Settings</a>
                <a href="/auth/logout" class="mr-2 text-blue-600 underline">Logout</a>
            </div>
        </div>
    </div>

    {@render children()}
{/if}