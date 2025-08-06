<script lang="ts">
    import { authStore } from "$lib/stores/authStore";
    import { createEventDispatcher } from "svelte";
    import { fade, fly } from "svelte/transition";

    const dispatch = createEventDispatcher();

    export let user: any;

    let password = "";
    let isLoading = false;
    let error: string | null = null;

    $: encryptionMethod = user?.encryptionMethod;
    $: isPasskeySupported =
        typeof navigator !== "undefined" && "credentials" in navigator;

    async function handlePasskeyUnlock() {
        try {
            isLoading = true;
            error = null;
            await authStore.unlockEncryption("passkey");
            dispatch("unlocked");
        } catch (err) {
            const errorMsg =
                err instanceof Error
                    ? err.message
                    : "Failed to authenticate with passkey";

            // If it's a decryption failure, navigate to recovery
            if (errorMsg.includes("decrypt") || errorMsg.includes("invalid")) {
                await authStore.initiateDataRecovery();
            } else {
                error = errorMsg;
            }
        } finally {
            isLoading = false;
        }
    }

    async function handlePasswordUnlock() {
        if (!password.trim()) {
            error = "Please enter your password";
            return;
        }

        try {
            isLoading = true;
            error = null;
            await authStore.unlockEncryption("password", password);
            dispatch("unlocked");
        } catch (err) {
            const errorMsg =
                err instanceof Error ? err.message : "Invalid password";

            // If it's a decryption failure, navigate to recovery
            if (errorMsg.includes("decrypt") || errorMsg.includes("invalid")) {
                await authStore.initiateDataRecovery();
            } else {
                error = errorMsg;
                password = ""; // Clear password on other errors
            }
        } finally {
            isLoading = false;
        }
    }
</script>

<div class="min-h-screen bg-base-100 flex items-center justify-center p-4">
    <div class="w-full max-w-sm" in:fly={{ y: 20, duration: 600 }}>
        <!-- Header -->
        <div class="text-center mb-8" in:fade={{ duration: 800, delay: 200 }}>
            <div
                class="w-16 h-16 rounded-full bg-primary/10 mx-auto mb-4 flex items-center justify-center"
            >
                <svg
                    class="w-8 h-8 text-primary"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                    />
                </svg>
            </div>
            <h1 class="text-xl font-medium text-base-content mb-1">
                Unlock Portfolio
            </h1>
            <p class="text-base-content/50 text-sm">
                Decrypt your data to continue
            </p>
        </div>

        <!-- Unlock Card -->
        <div
            class="bg-base-200/40 backdrop-blur border border-base-300/20 rounded-2xl p-6 shadow-lg"
            in:fly={{ y: 20, duration: 600, delay: 300 }}
        >
            <div class="text-center mb-6">
                <h2 class="text-lg font-medium text-base-content mb-2">
                    Decrypt Data
                </h2>
                <p class="text-base-content/50 text-xs">
                    Use your encryption method
                </p>
            </div>

            {#if error}
                <div
                    class="bg-error/10 border border-error/20 rounded-lg p-3 mb-4"
                    in:fly={{ y: -10, duration: 300 }}
                >
                    <div class="flex items-center gap-2">
                        <svg
                            class="w-4 h-4 text-error shrink-0"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                        >
                            <path
                                fill-rule="evenodd"
                                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                                clip-rule="evenodd"
                            />
                        </svg>
                        <span class="text-error text-sm">{error}</span>
                    </div>
                </div>
            {/if}

            <!-- Unlock methods -->
            <div class="space-y-3">
                {#if encryptionMethod === "passkey" && isPasskeySupported}
                    <!-- Passkey unlock -->
                    <button
                        class="btn btn-primary w-full gap-2 rounded-xl font-medium transition-all duration-200 hover:scale-[1.02] disabled:scale-100"
                        disabled={isLoading}
                        on:click={handlePasskeyUnlock}
                    >
                        {#if !isLoading}
                            <svg
                                class="w-4 h-4"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="2"
                                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                                />
                            </svg>
                            Unlock with passkey
                        {:else}
                            <span class="loading loading-spinner loading-sm"
                            ></span>
                            Authenticating...
                        {/if}
                    </button>

                    <!-- No fallback options - only show the method they originally chose -->
                {:else if encryptionMethod === "password"}
                    <!-- Password unlock -->
                    <div class="space-y-3">
                        <input
                            id="password-input"
                            type="password"
                            bind:value={password}
                            placeholder="Enter your password"
                            class="input input-bordered w-full rounded-xl focus:input-primary"
                            disabled={isLoading}
                            on:keydown={(e) =>
                                e.key === "Enter" && handlePasswordUnlock()}
                        />

                        <button
                            class="btn btn-primary w-full rounded-xl font-medium transition-all duration-200 hover:scale-[1.02] disabled:scale-100"
                            disabled={isLoading || !password.trim()}
                            on:click={handlePasswordUnlock}
                        >
                            {#if !isLoading}
                                <svg
                                    class="w-4 h-4"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        stroke-width="2"
                                        d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
                                    />
                                </svg>
                                Unlock portfolio
                            {:else}
                                <span class="loading loading-spinner loading-sm"
                                ></span>
                                Decrypting...
                            {/if}
                        </button>
                    </div>
                {/if}
            </div>

            <!-- Security notice -->
            <div
                class="mt-6 text-center"
                in:fade={{ duration: 600, delay: 400 }}
            >
                <p class="text-xs text-base-content/40">
                    Your data is encrypted end-to-end
                </p>
            </div>
        </div>
    </div>
</div>
