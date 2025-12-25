<script lang="ts">
    import {onMount} from "svelte";
    import {safe} from "@orpc/client";
    import {rpc} from "$lib/client/rpc";

    onMount(async () => {
        const params = new URLSearchParams(window.location.search);
        const silent = params.get('silent') === 'true';

        const { error } = await safe(
            rpc.users.logout()
        )

        if (error) {
            if (!silent) {
                alert(`Logout failed: ${error}`);
            }
        } else {
            if (!silent) {
                alert('You have been logged out successfully.');
            }
            window.location.href = '/';
        }
    });
</script>