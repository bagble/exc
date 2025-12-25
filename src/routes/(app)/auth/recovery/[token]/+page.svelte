<script lang="ts">
    import {onMount} from "svelte";
    import {rpc} from "$lib/client/rpc";
    import {safe} from "@orpc/client";

    const { data } = $props<{ data: { valid: boolean, token: string } }>();

    onMount(() => {
        if (!data.valid) {
            alert('Invalid or expired token. Please request a new password recovery.');
            window.location.href = '/auth/recovery';
        }
    })

    let password = $state('');
    let confirmPassword = $state('');
    async function updatePassword(event: Event) {
        event.preventDefault();
        if (!password || !confirmPassword) {
            alert("Please fill in all fields.");
            return;
        }

        if (password !== confirmPassword) {
            alert("Passwords do not match!");
            password = '';
            confirmPassword = '';
            return;
        }

        const { error } = await safe(
            rpc.users.resetPassword({
                token: data.token,
                password: password
            })
        );

        if (error) {
            alert(`Failed to update password: ${error.message}`);
            return;
        }

        alert(`Password has been updated successfully! You can now log in with your new password.`);
        window.location.href = '/auth';
    }
</script>

{#if data.valid}
<!--    <h1 class="text-3xl font-bold mb-4 text-center select-none">-->
<!--        Welcome to Super Awesome Project. Stock's Password Recovery Page-->
<!--    </h1>-->

    <div class="text-center w-full mx-auto mt-25">
        <form class="text-center mt-35 border w-100 mx-auto rounded p-5">
            <h2 class="text-2xl font-bold pointer-events-none select-none">Password Recovery</h2>

            <div class="flex flex-col items-center">
                <div class="flex items-center gap-2 w-80 justify-between mt-7.5 mb-1">
                    <label for="register-password" class="font-bold select-none text-sm">Password</label>
                </div>
                <input type="password" id="register-password" name="password" bind:value={password} class="rounded w-80 text-sm" required />

                <div class="flex items-center gap-2 w-80 justify-between mt-2.5 mb-1">
                    <label for="confirm-password" class="font-bold select-none text-sm">Confirm Password</label>
                </div>
                <input type="password" id="confirm-password" name="confirmPassword" bind:value={confirmPassword} class="rounded w-80 text-sm" required />
            </div>

            <button type="submit" class="w-45 h-10 bg-blue-500 text-white rounded hover:bg-blue-600 mt-5 transition select-none" onclick={(e) => updatePassword(e)}>Submit</button>
        </form>
    </div>
{/if}