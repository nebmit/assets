<script lang="ts">
    import { authStore } from "$lib/stores/authStore";
    import { createEventDispatcher } from "svelte";
    import { fade, fly } from "svelte/transition";
    import {
        TRANSITION_DURATIONS,
        ANIMATION_DELAYS,
        SLIDE_DISTANCE,
    } from "$lib/constants/animations";

    // Error messages
    const ERROR_MESSAGES = {
        auth: "Authentication failed",
        demo: "Demo mode failed",
    } as const;

    // Event dispatcher
    const dispatch = createEventDispatcher();

    // Component state
    let isLoading = false;
    let error: string | null = null;
    let isDemoLoading = false;

    // Computed properties
    $: isAnyLoading = isLoading || isDemoLoading;

    // Event handlers
    async function handleSSOAuthentication() {
        await performAuthAction(
            () => authStore.authenticateWithSSO(),
            () => (isLoading = true),
            () => (isLoading = false),
            ERROR_MESSAGES.auth,
        );
    }

    async function handleDemoMode() {
        await performAuthAction(
            () => authStore.enterDemoMode(),
            () => (isDemoLoading = true),
            () => (isDemoLoading = false),
            ERROR_MESSAGES.demo,
        );
    }

    // Helper functions
    async function performAuthAction(
        action: () => Promise<any>,
        startLoading: () => void,
        stopLoading: () => void,
        errorMessage: string,
    ) {
        try {
            startLoading();
            error = null;
            await action();
            dispatch("authenticated");
        } catch (err) {
            error = err instanceof Error ? err.message : errorMessage;
        } finally {
            stopLoading();
        }
    }
</script>

<div class="min-h-screen bg-base-100 flex items-center justify-center p-4">
    <div
        class="w-full max-w-sm"
        in:fly={{
            y: SLIDE_DISTANCE.MEDIUM,
            duration: TRANSITION_DURATIONS.SLOW,
        }}
    >
        <!-- Logo and Brand -->
        <div
            class="text-center mb-10"
            in:fade={{
                duration: TRANSITION_DURATIONS.HEADER,
                delay: ANIMATION_DELAYS.MEDIUM,
            }}
        >
            <h1
                class="text-3xl font-light tracking-tight text-base-content mb-3"
            >
                <span class="text-primary font-medium">a</span>ssets
            </h1>
            <p class="text-base-content/60 text-sm">
                Secure portfolio management
            </p>
        </div>

        <!-- Login Card -->
        <div
            class="bg-base-200/40 backdrop-blur border border-base-300/20 rounded-2xl p-6 shadow-lg"
        >
            <div class="text-center mb-6">
                <h2 class="text-lg font-medium text-base-content mb-1">
                    Sign in or create account
                </h2>
                <p class="text-base-content/50 text-xs">
                    New users will automatically get an account
                </p>
            </div>

            {#if error}
                <div
                    class="bg-error/10 border border-error/20 rounded-lg p-3 mb-4"
                    in:fly={{
                        y: -SLIDE_DISTANCE.SMALL,
                        duration: TRANSITION_DURATIONS.NORMAL,
                    }}
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

            <!-- Passkey Button -->
            <button
                class="btn btn-primary w-full gap-2 rounded-xl font-medium transition-all duration-200 hover:scale-[1.02] disabled:scale-100"
                disabled={isAnyLoading}
                on:click={handleSSOAuthentication}
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
                    Sign In / Register
                {:else}
                    <span class="loading loading-spinner loading-sm"></span>
                    Authenticating...
                {/if}
            </button>

            <!-- Alternative Options -->
            <div class="mt-6 space-y-3">
                <div class="flex gap-2">
                    <a
                        href="/how"
                        class="btn btn-ghost btn-sm flex-1 rounded-lg text-xs normal-case"
                    >
                        <svg
                            class="w-3 h-3"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                            />
                        </svg>
                        How it works
                    </a>
                    <button
                        class="btn btn-ghost btn-sm flex-1 rounded-lg text-xs normal-case"
                        disabled={isAnyLoading}
                        on:click={handleDemoMode}
                    >
                        {#if !isDemoLoading}
                            <svg
                                class="w-3 h-3"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="2"
                                    d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1.01M15 10h1.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                                />
                            </svg>
                            Try demo
                        {:else}
                            <span class="loading loading-spinner loading-xs"
                            ></span>
                            Loading...
                        {/if}
                    </button>
                </div>

                <div class="text-center">
                    <p class="text-xs text-base-content/40">
                        Secure passkey authentication • No passwords required
                    </p>
                </div>
            </div>
        </div>

        <!-- Footer -->
        <div
            class="text-center mt-8"
            in:fade={{
                duration: TRANSITION_DURATIONS.SLOW,
                delay: ANIMATION_DELAYS.LONG,
            }}
        >
            <p class="text-xs text-base-content/30">
                Open source portfolio manager
            </p>
        </div>
    </div>
</div>
