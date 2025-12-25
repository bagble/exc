<script lang="ts">
    import {rpc} from "$lib/client/rpc";
    import {safe} from "@orpc/client";

    let isLogin = $state(true);
    let username = $state('');
    let email = $state('');
    let password = $state('');
    let confirmPassword = $state('');

    function toggleForm() {
        isLogin = !isLogin;
        username = '';
        email = '';
        password = '';
        confirmPassword = '';
    }

    function confirmPasswordMatch(password: string, confirmPassword: string): boolean {
        return password === confirmPassword;
    }

    async function handleLogin(event: Event) {
        event.preventDefault();
        if (!email || !password) {
            alert("Please fill in all fields.");
            return;
        }

        const { error } = await safe(
            rpc.users.login({
                email,
                password,
            })
        );

        if (error) {
            if ("data" in error && error.data && typeof error.data === "object" && "fieldErrors" in error.data && error.data.fieldErrors) { // 필드 오류가 있는 경우
                for (const field of Object.keys(error.data.fieldErrors as Record<string, string[]>)) {
                    alert(`${(error.data.fieldErrors as Record<string, string[]>)[field].join(', ')}`);
                }
                return;
            }

            if (error.message.includes("Invalid email or password")) { // 이메일 또는 비밀번호가 잘못된 경우
                alert("Invalid email or password.");
            } else if (error.message.includes("Account is inactive")) { // 계정이 비활성화된 경우
                alert("Account is inactive. Please contact the administrator.");
            } else if (error.message.includes("Invalid email address")) { // 잘못된 이메일 형식
                alert("Invalid email address format.");
            } else if (error.message.includes("Rate limit exceeded")) { // 로그인 시도 횟수 초과
                alert("Too many login attempts. Please try again later.");
            } else { // 기타 알려지지 않은 오류가 발생한 경우
                alert(`Login failed: ${error.message}`);
            }
            return;
        } else {
            // alert("Login successful! Redirecting to home page."); // 성공 메시지 (필요시 활성화)
            window.location.href = '/';
        }
    }

    async function handleRegister(event: Event) {
        event.preventDefault();
        if (!username || !email || !password || !confirmPassword) {
            alert("Please fill in all fields.");
            return;
        }

        if (!confirmPasswordMatch(password, confirmPassword)) {
            alert("Passwords do not match!");
            password = '';
            confirmPassword = '';
            return;
        }

        const { error } = await safe(
            rpc.users.register({
                name: username,
                email,
                password,
            })
        );

        if (error) {
            if ("data" in error && error.data && typeof error.data === "object" && "fieldErrors" in error.data && error.data.fieldErrors) { // 필드 오류가 있는 경우
                for (const field of Object.keys(error.data.fieldErrors as Record<string, string[]>)) {
                    alert(`${(error.data.fieldErrors as Record<string, string[]>)[field].join(', ')}`);
                }
                return;
            }

            if (error.name === "CONFLICT") { // 이미 존재하는 데이터가 있는 경우
                if (error.message.includes("Email")) {
                    alert("Email already exists. Please use a different email.");
                } else if (error.message.includes("Name")) {
                    alert("Username already exists. Please choose a different username.");
                }
            } else if (error.message.includes("Rate limit exceeded")) { // 회원가입 시도 횟수 초과
                alert("Too many registration attempts. Please try again later.");
            } else { // 기타 알려지지 않은 오류가 발생한 경우
                alert(`Registration failed: ${error.message}`);
            }
            return;
        } else {
            alert("Registration successful! Please log in.");
            toggleForm();
        }
    }
</script>

<!--<h1 class="text-3xl font-bold mb-4 text-center select-none">-->
<!--    Welcome to Super Awesome Project. Stock's Authentication Page-->
<!--</h1>-->

{#if isLogin}
    <div class="text-center w-full mx-auto mt-25">
        <form class="text-center mt-35 border w-100 mx-auto rounded p-5">
            <h2 class="text-2xl font-bold pointer-events-none select-none">Login</h2>

            <div class="flex flex-col items-center">
                <div class="flex items-center gap-2 w-80 justify-between mt-7.5 mb-1">
                    <label for="login-email" class="font-bold select-none text-sm">Email</label>
                </div>
                <input type="email" id="login-email" name="email" bind:value={email} class="rounded w-80 text-sm" required />

                <div class="flex items-center gap-2 w-80 justify-between mt-2.5 mb-1">
                    <label for="login-password" class="font-bold select-none text-sm">Password</label>
                    <a href="auth/recovery" class="text-blue-600 hover:text-blue-800 pointer-events-auto text-sm">Forgot password?</a>
                </div>
                <input type="password" id="login-password" name="password" bind:value={password} class="rounded w-80 text-sm" required />
            </div>

            <button type="submit" class="w-45 h-10 bg-blue-500 text-white rounded hover:bg-blue-600 mt-5 transition select-none" onclick={(e) => handleLogin(e)}>Login</button>

            <span class="block mt-5 pointer-events-none select-none">Don't have an account? <button class="text-blue-600 hover:text-blue-800 pointer-events-auto" onclick={toggleForm}>Register here</button></span>
        </form>
    </div>
{:else}
    <div class="text-center w-full mx-auto mt-25">
        <form class="text-center mt-35 border w-100 mx-auto rounded p-5">
            <h2 class="text-2xl font-bold pointer-events-none select-none">Register</h2>

            <div class="flex flex-col items-center">
                <div class="flex items-center gap-2 w-80 justify-between mt-7.5 mb-1">
                    <label for="register-username" class="font-bold select-none text-sm">Username</label>
                </div>
                <input type="text" id="register-username" name="username" bind:value={username} class="rounded w-80 text-sm" required />

                <div class="flex items-center gap-2 w-80 justify-between mt-2.5 mb-1">
                    <label for="register-email" class="font-bold select-none text-sm">Email</label>
                </div>
                <input type="email" id="register-email" name="email" bind:value={email} class="rounded w-80 text-sm" required />

                <div class="flex items-center gap-2 w-80 justify-between mt-2.5 mb-1">
                    <label for="register-password" class="font-bold select-none text-sm">Password</label>
                </div>
                <input type="password" id="register-password" name="password" bind:value={password} class="rounded w-80 text-sm" required />

                <div class="flex items-center gap-2 w-80 justify-between mt-2.5 mb-1">
                    <label for="confirm-password" class="font-bold select-none text-sm">Confirm Password</label>
                </div>
                <input type="password" id="confirm-password" name="confirmPassword" bind:value={confirmPassword} class="rounded w-80 text-sm" required />
            </div>

            <button type="submit" class="w-45 h-10 bg-blue-500 text-white rounded hover:bg-blue-600 mt-5 transition select-none" onclick={(e) => handleRegister(e)}>Register</button>

            <span class="block mt-5 pointer-events-none select-none">Already have an account? <button class="text-blue-600 hover:text-blue-800 pointer-events-auto" onclick={toggleForm}>Login here</button></span>
        </form>
    </div>
{/if}