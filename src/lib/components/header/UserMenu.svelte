<script lang="ts">
    import DataManagementSection from "./DataManagementSection.svelte";
    import PreferenceButtons from "./PreferenceButtons.svelte";

    export let isOpen: boolean;
    export let selectedCurrency: string;
    export let selectedLanguage: string;
    export let selectedColorScheme: string;

    export let onCurrencyChange: (currency: string) => void;
    export let onLanguageChange: (language: string) => void;
    export let onColorSchemeChange: (scheme: string) => void;

    export let onDataExport: () => void;
    export let onPasswordMigration: () => void;
    export let onLogout: () => void;
</script>

{#if isOpen}
    <div
        class="absolute right-0 top-full mt-2 bg-base-200 border border-base-300/50 rounded-xl shadow-xl py-2 min-w-52 z-20 animate-in slide-in-from-top-2 fade-in duration-200"
        role="menu"
        tabindex="-1"
        on:click={(e) => e.stopPropagation()}
        on:keydown={(e) => e.stopPropagation()}
    >
        <!-- Preferences Section -->
        <div class="px-3 py-2 border-b border-base-300/30">
            <div
                class="text-xs text-base-content/60 font-medium tracking-wide uppercase"
            >
                Preferences
            </div>
        </div>

        <PreferenceButtons
            {selectedCurrency}
            {selectedLanguage}
            {selectedColorScheme}
            {onCurrencyChange}
            {onLanguageChange}
            {onColorSchemeChange}
        />

        <DataManagementSection
            {onDataExport}
            {onPasswordMigration}
            {onLogout}
        />
    </div>
{/if}
