<script lang="ts">
    import { onMount } from "svelte";
    import UserInfo from "./UserInfo.svelte";
    import UserMenuButton from "./UserMenuButton.svelte";
    import UserMenu from "./UserMenu.svelte";

    export let user: { id: string; isLoggedIn: boolean };
    export let onDataExport: () => void;
    export let onPasswordMigration: () => void;
    export let onLogout: () => void;

    let showUserMenu = false;
    let userMenuContainer: HTMLDivElement;
    let userMenuButton: UserMenuButton;

    let selectedCurrency = "USD";
    let selectedLanguage = "en";
    let selectedColorScheme = "light";

    function toggleUserMenu() {
        showUserMenu = !showUserMenu;
    }

    function closeUserMenu() {
        showUserMenu = false;
    }

    function handleClickOutside(event: MouseEvent) {
        if (
            showUserMenu &&
            userMenuContainer &&
            !userMenuContainer.contains(event.target as Node)
        ) {
            closeUserMenu();
        }
    }

    function handleCurrencyChange(currency: string) {
        selectedCurrency = currency;
        // TODO: Persist to backend
    }

    function handleLanguageChange(language: string) {
        selectedLanguage = language;
        // TODO: Persist to backend
    }

    function handleColorSchemeChange(scheme: string) {
        selectedColorScheme = scheme;
        // TODO: Persist to backend
    }

    function handleDataExportClick() {
        onDataExport();
        closeUserMenu();
    }

    function handlePasswordMigrationClick() {
        onPasswordMigration();
        closeUserMenu();
    }

    function handleLogoutClick() {
        onLogout();
        closeUserMenu();
    }

    onMount(() => {
        document.addEventListener("click", handleClickOutside);

        return () => {
            document.removeEventListener("click", handleClickOutside);
        };
    });
</script>

<div class="flex items-center gap-4">
    <!-- User Info & Menu -->
    <div class="flex items-center gap-3">
        <UserInfo userId={user.id} />

        <!-- User Menu -->
        <div class="relative" bind:this={userMenuContainer}>
            <UserMenuButton
                bind:this={userMenuButton}
                isOpen={showUserMenu}
                onClick={toggleUserMenu}
            />

            <UserMenu
                isOpen={showUserMenu}
                {selectedCurrency}
                {selectedLanguage}
                {selectedColorScheme}
                onCurrencyChange={handleCurrencyChange}
                onLanguageChange={handleLanguageChange}
                onColorSchemeChange={handleColorSchemeChange}
                onDataExport={handleDataExportClick}
                onPasswordMigration={handlePasswordMigrationClick}
                onLogout={handleLogoutClick}
            />
        </div>
    </div>
</div>
