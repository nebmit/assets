<script lang="ts">
    import { authStore } from "$lib/stores/authStore";
    import { createEventDispatcher } from "svelte";
    import { fade, fly } from "svelte/transition";

    const dispatch = createEventDispatcher();

    let isLoading = false;
    let showResetConfirmation = false;

    async function handleExportData() {
        try {
            isLoading = true;
            // In a real app, this would export the encrypted data for manual recovery
            await new Promise((resolve) => setTimeout(resolve, 1000));

            // Simulate downloading encrypted data
            const blob = new Blob(["encrypted-portfolio-data"], {
                type: "application/octet-stream",
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "portfolio-encrypted-backup.dat";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error("Export failed:", err);
        } finally {
            isLoading = false;
        }
    }

    async function handleResetAccount() {
        try {
            isLoading = true;
            await authStore.resetAccount();
            dispatch("accountReset");
        } catch (err) {
            console.error("Reset failed:", err);
        } finally {
            isLoading = false;
        }
    }

    function handleBackToUnlock() {
        authStore.logout();
        dispatch("backToAuth");
    }
</script>

<div class="min-h-screen bg-base-100 flex items-center justify-center p-4">
    <div class="w-full max-w-md" in:fly={{ y: 20, duration: 600 }}>
        <!-- Warning Header -->
        <div class="text-center mb-8" in:fade={{ duration: 800, delay: 200 }}>
            <div
                class="w-16 h-16 rounded-full bg-error/10 mx-auto mb-4 flex items-center justify-center"
            >
                <svg
                    class="w-8 h-8 text-error"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
                    />
                </svg>
            </div>
            <h1 class="text-xl font-medium text-base-content mb-2">
                Decryption Failed
            </h1>
            <p class="text-base-content/60 text-sm">
                Unable to decrypt your portfolio data
            </p>
        </div>

        <!-- Recovery Options Card -->
        <div
            class="bg-base-200/40 backdrop-blur border border-base-300/20 rounded-2xl p-6 shadow-lg"
            in:fly={{ y: 20, duration: 600, delay: 300 }}
        >
            <div class="mb-6">
                <h2 class="text-lg font-medium text-base-content mb-2">
                    Recovery Options
                </h2>
                <p class="text-base-content/60 text-sm">
                    Your data couldn't be decrypted. This might happen if you
                    entered the wrong password or there's an issue with your
                    passkey.
                </p>
            </div>

            <div class="space-y-4">
                <!-- Try Again -->
                <button
                    class="btn btn-outline w-full rounded-xl font-medium"
                    on:click={handleBackToUnlock}
                >
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
                            d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
                        />
                    </svg>
                    Try Again
                </button>

                <!-- Export Encrypted Data -->
                <button
                    class="btn btn-ghost w-full rounded-xl font-medium"
                    disabled={isLoading}
                    on:click={handleExportData}
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
                                d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                            />
                        </svg>
                        Export Encrypted Data
                    {:else}
                        <span class="loading loading-spinner loading-sm"></span>
                        Exporting...
                    {/if}
                </button>

                <!-- Reset Account -->
                {#if !showResetConfirmation}
                    <button
                        class="btn btn-error btn-outline w-full rounded-xl font-medium"
                        on:click={() => (showResetConfirmation = true)}
                    >
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
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
                        </svg>
                        Reset Account
                    </button>
                {:else}
                    <!-- Reset Confirmation -->
                    <div
                        class="bg-error/10 border border-error/20 rounded-lg p-4"
                        in:fly={{ y: 10, duration: 300 }}
                    >
                        <div class="text-center mb-4">
                            <h3 class="font-medium text-error mb-1">
                                Confirm Account Reset
                            </h3>
                            <p class="text-xs text-base-content/60">
                                This will permanently delete all your encrypted
                                data. This action cannot be undone.
                            </p>
                        </div>
                        <div class="flex gap-2">
                            <button
                                class="btn btn-ghost btn-sm flex-1"
                                on:click={() => (showResetConfirmation = false)}
                            >
                                Cancel
                            </button>
                            <button
                                class="btn btn-error btn-sm flex-1"
                                disabled={isLoading}
                                on:click={handleResetAccount}
                            >
                                {#if !isLoading}
                                    Reset
                                {:else}
                                    <span
                                        class="loading loading-spinner loading-xs"
                                    ></span>
                                {/if}
                            </button>
                        </div>
                    </div>
                {/if}
            </div>

            <!-- Help Text -->
            <div
                class="mt-6 p-4 bg-base-300/30 rounded-lg"
                in:fade={{ duration: 600, delay: 400 }}
            >
                <div class="text-center">
                    <h4 class="font-medium text-base-content text-sm mb-2">
                        Need Help?
                    </h4>
                    <div class="space-y-1 text-xs text-base-content/60">
                        <p>• Double-check your password for typos</p>
                        <p>• Ensure your passkey device is working properly</p>
                        <p>• Export your data before resetting your account</p>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>
