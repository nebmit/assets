<script lang="ts">
    export let isOpen = false;

    let currentPassword = "";
    let newPassword = "";
    let confirmPassword = "";
    let isMigrating = false;
    let showCurrentPassword = false;
    let showNewPassword = false;
    let showConfirmPassword = false;
    let migrationStep: "verify" | "migrate" | "complete" = "verify";

    $: passwordsMatch = newPassword === confirmPassword;
    $: isNewPasswordValid = newPassword.length >= 8;
    $: canProceed =
        currentPassword.length > 0 && isNewPasswordValid && passwordsMatch;

    function closeModal() {
        isOpen = false;
        currentPassword = "";
        newPassword = "";
        confirmPassword = "";
        migrationStep = "verify";
    }

    async function handlePasswordMigration() {
        if (!canProceed) return;

        isMigrating = true;

        try {
            // TODO: Implement actual migration logic here
            // Step 1: Verify current password
            migrationStep = "verify";
            await new Promise((resolve) => setTimeout(resolve, 1000));

            // Step 2: Migrate data
            migrationStep = "migrate";
            await new Promise((resolve) => setTimeout(resolve, 3000));

            // Step 3: Complete
            migrationStep = "complete";
            await new Promise((resolve) => setTimeout(resolve, 1000));

            // Auto-close after showing success
            setTimeout(() => {
                closeModal();
            }, 2000);
        } catch (error) {
            console.error("Migration failed:", error);
        } finally {
            isMigrating = false;
        }
    }

    function handleBackdropClick(event: MouseEvent) {
        if (event.target === event.currentTarget && !isMigrating) {
            closeModal();
        }
    }

    function togglePasswordVisibility(field: "current" | "new" | "confirm") {
        switch (field) {
            case "current":
                showCurrentPassword = !showCurrentPassword;
                break;
            case "new":
                showNewPassword = !showNewPassword;
                break;
            case "confirm":
                showConfirmPassword = !showConfirmPassword;
                break;
        }
    }
</script>

{#if isOpen}
    <!-- Modal Backdrop -->
    <div
        class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
        role="dialog"
        aria-labelledby="migration-modal-title"
        aria-modal="true"
        tabindex="-1"
        on:click={handleBackdropClick}
        on:keydown={(e) => e.key === "Escape" && !isMigrating && closeModal()}
    >
        <!-- Modal Content -->
        <div
            class="bg-base-100 rounded-xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto"
        >
            <!-- Header -->
            <div class="p-6 border-b border-base-300/30">
                <div class="flex items-center justify-between">
                    <h2
                        id="migration-modal-title"
                        class="text-xl font-medium text-base-content"
                    >
                        Migrate Password
                    </h2>
                    {#if !isMigrating}
                        <button
                            class="p-1 hover:bg-base-200 rounded-lg transition-colors"
                            aria-label="Close modal"
                            on:click={closeModal}
                        >
                            <svg
                                class="w-5 h-5 text-base-content/60"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="2"
                                    d="M6 18L18 6M6 6l12 12"
                                />
                            </svg>
                        </button>
                    {/if}
                </div>
                <p class="text-sm text-base-content/60 mt-2">
                    {#if migrationStep === "verify"}
                        Change your encryption password and re-encrypt all
                        portfolio data
                    {:else if migrationStep === "migrate"}
                        Migrating your data with the new password...
                    {:else}
                        Password migration completed successfully
                    {/if}
                </p>
            </div>

            <!-- Form -->
            <div class="p-6">
                {#if migrationStep === "verify"}
                    <div class="space-y-6">
                        <!-- Current Password -->
                        <div>
                            <label
                                for="current-password"
                                class="block text-sm font-medium text-base-content mb-2"
                            >
                                Current Password
                            </label>
                            <div class="relative">
                                <input
                                    id="current-password"
                                    type={showCurrentPassword
                                        ? "text"
                                        : "password"}
                                    bind:value={currentPassword}
                                    placeholder="Enter your current password"
                                    class="input input-bordered w-full pr-10"
                                    disabled={isMigrating}
                                />
                                <button
                                    type="button"
                                    class="absolute right-3 top-1/2 -translate-y-1/2 text-base-content/60 hover:text-base-content"
                                    aria-label={showCurrentPassword
                                        ? "Hide password"
                                        : "Show password"}
                                    on:click={() =>
                                        togglePasswordVisibility("current")}
                                >
                                    {#if showCurrentPassword}
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
                                                d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21"
                                            />
                                        </svg>
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
                                                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                                            />
                                            <path
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                                stroke-width="2"
                                                d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                                            />
                                        </svg>
                                    {/if}
                                </button>
                            </div>
                        </div>

                        <!-- New Password -->
                        <div>
                            <label
                                for="new-password"
                                class="block text-sm font-medium text-base-content mb-2"
                            >
                                New Password
                            </label>
                            <div class="relative">
                                <input
                                    id="new-password"
                                    type={showNewPassword ? "text" : "password"}
                                    bind:value={newPassword}
                                    placeholder="Enter your new password"
                                    class="input input-bordered w-full pr-10"
                                    disabled={isMigrating}
                                />
                                <button
                                    type="button"
                                    class="absolute right-3 top-1/2 -translate-y-1/2 text-base-content/60 hover:text-base-content"
                                    aria-label={showNewPassword
                                        ? "Hide password"
                                        : "Show password"}
                                    on:click={() =>
                                        togglePasswordVisibility("new")}
                                >
                                    {#if showNewPassword}
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
                                                d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21"
                                            />
                                        </svg>
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
                                                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                                            />
                                            <path
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                                stroke-width="2"
                                                d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                                            />
                                        </svg>
                                    {/if}
                                </button>
                            </div>
                            {#if newPassword.length > 0 && !isNewPasswordValid}
                                <p class="text-error text-xs mt-1">
                                    Password must be at least 8 characters long
                                </p>
                            {/if}
                        </div>

                        <!-- Confirm Password -->
                        <div>
                            <label
                                for="confirm-password"
                                class="block text-sm font-medium text-base-content mb-2"
                            >
                                Confirm New Password
                            </label>
                            <div class="relative">
                                <input
                                    id="confirm-password"
                                    type={showConfirmPassword
                                        ? "text"
                                        : "password"}
                                    bind:value={confirmPassword}
                                    placeholder="Confirm your new password"
                                    class="input input-bordered w-full pr-10"
                                    disabled={isMigrating}
                                />
                                <button
                                    type="button"
                                    class="absolute right-3 top-1/2 -translate-y-1/2 text-base-content/60 hover:text-base-content"
                                    aria-label={showConfirmPassword
                                        ? "Hide password"
                                        : "Show password"}
                                    on:click={() =>
                                        togglePasswordVisibility("confirm")}
                                >
                                    {#if showConfirmPassword}
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
                                                d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21"
                                            />
                                        </svg>
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
                                                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                                            />
                                            <path
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                                stroke-width="2"
                                                d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                                            />
                                        </svg>
                                    {/if}
                                </button>
                            </div>
                            {#if confirmPassword.length > 0 && !passwordsMatch}
                                <p class="text-error text-xs mt-1">
                                    Passwords do not match
                                </p>
                            {/if}
                        </div>

                        <!-- Warning -->
                        <div
                            class="bg-warning/10 border border-warning/20 rounded-lg p-4"
                        >
                            <div class="flex items-start gap-3">
                                <svg
                                    class="w-4 h-4 text-warning flex-shrink-0 mt-0.5"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        stroke-width="2"
                                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
                                    />
                                </svg>
                                <div>
                                    <div
                                        class="text-sm font-medium text-warning"
                                    >
                                        Important Notice
                                    </div>
                                    <div
                                        class="text-xs text-base-content/60 mt-1"
                                    >
                                        This process will re-encrypt all your
                                        portfolio data. Make sure to remember
                                        your new password as it cannot be
                                        recovered.
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                {:else if migrationStep === "migrate"}
                    <!-- Migration Progress -->
                    <div class="text-center space-y-6 py-8">
                        <div class="w-16 h-16 mx-auto">
                            <svg
                                class="w-16 h-16 animate-spin text-primary"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="2"
                                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                                />
                            </svg>
                        </div>
                        <div>
                            <h3
                                class="text-lg font-medium text-base-content mb-2"
                            >
                                Migrating Your Data
                            </h3>
                            <p class="text-sm text-base-content/60">
                                Re-encrypting portfolio data with your new
                                password...
                            </p>
                        </div>
                        <div class="w-full max-w-xs mx-auto">
                            <div class="progress progress-primary"></div>
                        </div>
                    </div>
                {:else}
                    <!-- Success -->
                    <div class="text-center space-y-6 py-8">
                        <div
                            class="w-16 h-16 mx-auto bg-success/10 rounded-full flex items-center justify-center"
                        >
                            <svg
                                class="w-8 h-8 text-success"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="2"
                                    d="M5 13l4 4L19 7"
                                />
                            </svg>
                        </div>
                        <div>
                            <h3
                                class="text-lg font-medium text-base-content mb-2"
                            >
                                Migration Complete
                            </h3>
                            <p class="text-sm text-base-content/60">
                                Your password has been successfully updated and
                                all data re-encrypted.
                            </p>
                        </div>
                    </div>
                {/if}
            </div>

            <!-- Footer -->
            {#if migrationStep === "verify"}
                <div
                    class="p-6 border-t border-base-300/30 flex gap-3 justify-end"
                >
                    <button
                        class="px-4 py-2 text-sm text-base-content/60 hover:text-base-content transition-colors"
                        on:click={closeModal}
                        disabled={isMigrating}
                    >
                        Cancel
                    </button>
                    <button
                        class="px-6 py-2 bg-primary text-primary-content rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        on:click={handlePasswordMigration}
                        disabled={!canProceed || isMigrating}
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
                                d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
                            />
                        </svg>
                        Migrate Password
                    </button>
                </div>
            {/if}
        </div>
    </div>
{/if}
