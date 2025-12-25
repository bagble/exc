<script lang="ts">
    import '../../app.css';
    import type { Snippet } from 'svelte';

    import { initializeDevice } from "$lib/client/device_id";
    import { onMount } from "svelte";

    let { children, data }: {
        children: Snippet;
        data: { validDevice: boolean }
    } = $props();

    onMount(() => {
        initializeDevice(data.validDevice);
    });
</script>

<svelte:head>
    <link rel="icon" href="/favicon.svg" />
</svelte:head>

{@render children()}
