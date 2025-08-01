<script lang="ts">
    import DataExportModal from "../DataExportModal.svelte";
    import PasswordMigrationModal from "../PasswordMigrationModal.svelte";
    import UserSection from "./UserSection.svelte";

    export let user: { id: string; isLoggedIn: boolean };

    let showDataExportModal = false;
    let showPasswordMigrationModal = false;

    function handleLogin() {
        console.log("Login");
        // TODO: Handle login
    }

    function handleLogout() {
        console.log("Logout");
        // TODO: Handle logout
    }

    function handleDataExport() {
        showDataExportModal = true;
    }

    function handlePasswordMigration() {
        showPasswordMigrationModal = true;
    }
</script>

<!-- Header Section -->
<div class="p-8 max-w-6xl mx-auto">
    <div
        class="flex justify-between items-center mb-12 pb-6 border-b border-base-300/30"
    >
        <div class="flex items-center">
            <a
                href="/"
                class="text-2xl font-medium tracking-tight text-base-content hover:text-primary/90 transition-colors duration-200"
            >
                <span class="text-primary">a</span>ssets
            </a>
        </div>

        {#if user.isLoggedIn}
            <UserSection
                {user}
                onDataExport={handleDataExport}
                onPasswordMigration={handlePasswordMigration}
                onLogout={handleLogout}
            />
        {:else}
            <button
                class="text-sm text-base-content/60 hover:text-primary transition-colors duration-200 underline decoration-dotted underline-offset-4 hover:decoration-solid"
                on:click={handleLogin}
            >
                Login
            </button>
        {/if}
    </div>
</div>

<!-- Modals -->
<DataExportModal bind:isOpen={showDataExportModal} />
<PasswordMigrationModal bind:isOpen={showPasswordMigrationModal} />
