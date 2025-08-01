<script lang="ts">
    export let selectedCurrency: string;
    export let selectedLanguage: string;
    export let selectedColorScheme: string;
    export let onCurrencyChange: (currency: string) => void;
    export let onLanguageChange: (language: string) => void;
    export let onColorSchemeChange: (scheme: string) => void;

    const currencies = ["USD", "EUR", "GBP"];
    const languages = [
        { code: "en", label: "EN" },
        { code: "ja", label: "JA" },
    ];
    const colorSchemes = ["light", "dark", "auto"];

    function getButtonClass(isSelected: boolean): string {
        return `text-xs px-2 py-1 rounded transition-colors ${
            isSelected
                ? "bg-primary/10 text-primary border border-primary/20"
                : "bg-base-300/30 text-base-content/60 hover:bg-base-300/50"
        }`;
    }
</script>

<!-- Currency Preferences -->
<div class="px-3 py-2">
    <div class="text-xs text-base-content/60 mb-2">Currency</div>
    <div class="flex gap-2">
        {#each currencies as currency}
            <button
                class={getButtonClass(selectedCurrency === currency)}
                on:click={() => onCurrencyChange(currency)}
            >
                {currency}
            </button>
        {/each}
    </div>
</div>

<!-- Language Preferences -->
<div class="px-3 py-2">
    <div class="text-xs text-base-content/60 mb-2">Language</div>
    <div class="flex gap-2">
        {#each languages as language}
            <button
                class={getButtonClass(selectedLanguage === language.code)}
                on:click={() => onLanguageChange(language.code)}
            >
                {language.label}
            </button>
        {/each}
    </div>
</div>

<!-- Theme Preferences -->
<div class="px-3 py-2">
    <div class="text-xs text-base-content/60 mb-2">Theme</div>
    <div class="flex gap-2">
        {#each colorSchemes as scheme}
            <button
                class={getButtonClass(selectedColorScheme === scheme)}
                on:click={() => onColorSchemeChange(scheme)}
            >
                {scheme.charAt(0).toUpperCase() + scheme.slice(1)}
            </button>
        {/each}
    </div>
</div>
