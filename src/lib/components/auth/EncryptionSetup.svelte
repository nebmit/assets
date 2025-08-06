<script lang="ts">
    import { authStore } from "$lib/stores/authStore";
    import { createEventDispatcher } from "svelte";
    import type { EncryptionKeyOptions } from "$lib/types/user";
    import { fade, fly } from "svelte/transition";

    // Constants
    const TRANSITION_DURATIONS = {
        container: 600,
        header: 800,
        card: 600,
        error: 300,
    } as const;

    const DELAYS = {
        header: 200,
        card: 300,
    } as const;

    const PASSWORD_STRENGTH = {
        VERY_WEAK: 0,
        WEAK: 1,
        FAIR: 2,
        GOOD: 3,
        STRONG: 4,
        MIN_ACCEPTABLE: 3,
    } as const;

    const STRENGTH_LABELS = [
        "Very Weak",
        "Weak",
        "Fair",
        "Good",
        "Strong",
    ] as const;
    const STRENGTH_COLORS = [
        "error",
        "warning",
        "warning",
        "success",
        "success",
    ] as const;

    // Event dispatcher
    const dispatch = createEventDispatcher();

    // Component state
    let selectedMethod: "passkey" | "password" = "passkey";
    let password = "";
    let confirmPassword = "";
    let isLoading = false;
    let error: string | null = null;

    // Computed properties
    $: isPasskeySupported =
        typeof navigator !== "undefined" && "credentials" in navigator;
    $: passwordStrength = calculatePasswordStrength(password);
    $: passwordsMatch = password === confirmPassword && password.length > 0;
    $: canProceed =
        selectedMethod === "passkey"
            ? isPasskeySupported
            : passwordsMatch &&
              passwordStrength >= PASSWORD_STRENGTH.MIN_ACCEPTABLE;

    // Helper functions
    function calculatePasswordStrength(pwd: string): number {
        let strength = 0;
        if (pwd.length >= 8) strength++;
        if (/[a-z]/.test(pwd)) strength++;
        if (/[A-Z]/.test(pwd)) strength++;
        if (/[0-9]/.test(pwd)) strength++;
        if (/[^A-Za-z0-9]/.test(pwd)) strength++;
        return strength;
    }

    function getStrengthText(strength: number): string {
        return STRENGTH_LABELS[strength] || STRENGTH_LABELS[0];
    }

    function getStrengthColor(strength: number): string {
        return STRENGTH_COLORS[strength] || STRENGTH_COLORS[0];
    }

    // Event handlers
    async function handleSetupEncryption() {
        try {
            isLoading = true;
            error = null;

            const options: EncryptionKeyOptions = {
                type: selectedMethod,
                data:
                    selectedMethod === "password"
                        ? password
                        : new ArrayBuffer(0),
            };

            await authStore.setupEncryptionKey(options);
            dispatch("encryptionSetup");
        } catch (err) {
            error =
                err instanceof Error
                    ? err.message
                    : "Failed to setup encryption";
        } finally {
            isLoading = false;
        }
    }
</script>

<div class="min-h-screen bg-base-100 flex items-center justify-center p-4">
    <div
        class="w-full max-w-md"
        in:fly={{ y: 20, duration: TRANSITION_DURATIONS.container }}
    >
        <!-- Welcome header -->
        <div
            class="text-center mb-8"
            in:fade={{
                duration: TRANSITION_DURATIONS.header,
                delay: DELAYS.header,
            }}
        >
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
            <h1 class="text-xl font-medium text-base-content mb-2">
                Setup Encryption
            </h1>
            <p class="text-base-content/60 text-sm">
                Choose how to secure your portfolio data
            </p>
        </div>

        <!-- Setup Card -->
        <div
            class="bg-base-200/40 backdrop-blur border border-base-300/20 rounded-2xl p-6 shadow-lg"
            in:fly={{
                y: 20,
                duration: TRANSITION_DURATIONS.card,
                delay: DELAYS.card,
            }}
        >
            {#if error}
                <div
                    class="bg-error/10 border border-error/20 rounded-lg p-3 mb-4"
                    in:fly={{ y: -10, duration: TRANSITION_DURATIONS.error }}
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

            <div class="mb-6">
                <h3 class="text-lg font-medium text-base-content mb-4">
                    Choose your security method
                </h3>

                <div class="space-y-3">
                    <!-- Passkey Option -->
                    <div
                        class="border border-base-300/30 rounded-xl p-4 transition-all duration-200"
                        class:border-primary={selectedMethod === "passkey"}
                    >
                        <label class="cursor-pointer flex items-start gap-3">
                            <input
                                type="radio"
                                bind:group={selectedMethod}
                                value="passkey"
                                class="radio radio-primary mt-1"
                                disabled={!isPasskeySupported}
                            />
                            <div class="flex-1">
                                <div class="flex items-center gap-2 mb-1">
                                    <span class="font-medium text-base-content"
                                        >Passkey</span
                                    >
                                    {#if !isPasskeySupported}
                                        <span class="badge badge-error badge-xs"
                                            >Not Supported</span
                                        >
                                    {:else}
                                        <span
                                            class="badge badge-primary badge-xs"
                                            >Recommended</span
                                        >
                                    {/if}
                                </div>
                                <p class="text-sm text-base-content/60">
                                    Use your device's biometrics or security
                                    key. More secure and convenient.
                                </p>
                            </div>
                            <svg
                                class="w-5 h-5 text-base-content/40 mt-1"
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
                        </label>
                    </div>

                    <!-- Password Option -->
                    <div
                        class="border border-base-300/30 rounded-xl p-4 transition-all duration-200"
                        class:border-primary={selectedMethod === "password"}
                    >
                        <label class="cursor-pointer flex items-start gap-3">
                            <input
                                type="radio"
                                bind:group={selectedMethod}
                                value="password"
                                class="radio radio-primary mt-1"
                            />
                            <div class="flex-1">
                                <span class="font-medium text-base-content"
                                    >Master Password</span
                                >
                                <p class="text-sm text-base-content/60">
                                    A strong password that encrypts your data.
                                    Don't forget it!
                                </p>
                            </div>
                            <svg
                                class="w-5 h-5 text-base-content/40 mt-1"
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
                        </label>
                    </div>
                </div>
            </div>

            <!-- Password Fields Container - Smooth transition to prevent layout shift -->
            <div
                class="mb-6 overflow-hidden transition-all duration-300 ease-in-out"
                style="max-height: {selectedMethod === 'password'
                    ? '300px'
                    : '0px'}; opacity: {selectedMethod === 'password'
                    ? '1'
                    : '0'};"
            >
                <div class="space-y-4 pt-2">
                    <div class="form-control">
                        <label class="label" for="master-password">
                            <span class="label-text font-medium"
                                >Create your master password</span
                            >
                        </label>
                        <input
                            id="master-password"
                            type="password"
                            bind:value={password}
                            placeholder="Enter a strong password"
                            class="input input-bordered w-full rounded-xl focus:input-primary"
                            disabled={isLoading}
                        />
                        {#if password.length > 0}
                            <div
                                class="mt-2"
                                in:fly={{ y: -10, duration: 300 }}
                            >
                                <div
                                    class="flex justify-between items-center mb-1"
                                >
                                    <span class="text-xs text-base-content/60"
                                        >Strength:</span
                                    >
                                    <span
                                        class="text-xs text-{getStrengthColor(
                                            passwordStrength,
                                        )}"
                                    >
                                        {getStrengthText(passwordStrength)}
                                    </span>
                                </div>
                                <progress
                                    class="progress progress-{getStrengthColor(
                                        passwordStrength,
                                    )} w-full h-1"
                                    value={passwordStrength}
                                    max="5"
                                ></progress>
                            </div>
                        {/if}
                    </div>

                    <div class="form-control">
                        <label class="label" for="confirm-password">
                            <span class="label-text font-medium"
                                >Confirm password</span
                            >
                        </label>
                        <input
                            id="confirm-password"
                            type="password"
                            bind:value={confirmPassword}
                            placeholder="Confirm your password"
                            class="input input-bordered w-full rounded-xl focus:input-primary"
                            class:input-error={confirmPassword.length > 0 &&
                                !passwordsMatch}
                            disabled={isLoading}
                        />
                        {#if confirmPassword.length > 0 && !passwordsMatch}
                            <div
                                class="label"
                                in:fly={{ y: -10, duration: 300 }}
                            >
                                <span class="label-text-alt text-error"
                                    >Passwords do not match</span
                                >
                            </div>
                        {/if}
                    </div>
                </div>
            </div>

            <!-- Setup Button -->
            <button
                class="btn btn-primary w-full rounded-xl font-medium transition-all duration-200 hover:scale-[1.02] disabled:scale-100"
                disabled={!canProceed || isLoading}
                on:click={handleSetupEncryption}
            >
                {#if !isLoading}
                    {#if selectedMethod === "passkey"}
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
                        Setup Passkey
                    {:else}
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
                                d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1721 9z"
                            />
                        </svg>
                        Create Password
                    {/if}
                {:else}
                    <span class="loading loading-spinner loading-sm"></span>
                    Setting up encryption...
                {/if}
            </button>

            <!-- Security Notice -->
            {#if selectedMethod === "password"}
                <div
                    class="mt-4 p-3 bg-warning/10 border border-warning/20 rounded-lg"
                >
                    <div class="flex gap-2">
                        <svg
                            class="w-4 h-4 text-warning shrink-0 mt-0.5"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                        >
                            <path
                                fill-rule="evenodd"
                                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                                clip-rule="evenodd"
                            />
                        </svg>
                        <div>
                            <div class="font-medium text-warning text-xs">
                                Important
                            </div>
                            <div class="text-xs text-base-content/60 mt-0.5">
                                If you lose this password, your portfolio data
                                cannot be recovered. Consider using a password
                                manager.
                            </div>
                        </div>
                    </div>
                </div>
            {/if}
        </div>
    </div>
</div>
