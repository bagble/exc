<script lang="ts">
    import {safe} from "@orpc/client";
    import {rpc} from "$lib/client/rpc";

    let email = '';

    async function handleRecovery(event: Event) {
        event.preventDefault();
        if (email) {
            await safe(
                rpc.users.recoveryToken({
                    email,
                })
            );

            alert(`Password recovery link sent. if this email is registered.`);
            window.location.href = '/auth';
        } else {
            alert('Please enter your email address.');
        }
    }
</script>

<!--<h1 class="text-3xl font-bold mb-4 text-center select-none">-->
<!--    Welcome to Super Awesome Project. Stock's Password Recovery Page-->
<!--</h1>-->

<div class="text-center w-full mx-auto mt-25">
    <form class="text-center mt-35 border w-100 mx-auto rounded p-5">
        <h2 class="text-2xl font-bold pointer-events-none select-none">Password Recovery</h2>

        <div class="flex flex-col items-center">
            <div class="flex items-center gap-2 w-80 justify-between mt-7.5 mb-1">
                <label for="recovery-email" class="font-bold select-none text-sm">Email</label>
            </div>
            <input type="email" id="recovery-email" name="email" bind:value={email} class="rounded w-80 text-sm" required />
        </div>

        <button type="submit" class="w-45 h-10 bg-blue-500 text-white rounded hover:bg-blue-600 mt-5 transition select-none" onclick={(e) => handleRecovery(e)}>Submit</button>
    </form>
</div>