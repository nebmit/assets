<script lang="ts">
    import type { Asset } from "$lib/types/asset.js";
    import AssetCard from "./AssetCard.svelte";

    export let assets: Asset[];
    export let isEditMode: boolean = false;
    export let onEdit: () => void;
    export let onAddAsset: () => void;
    export let onDeleteAsset: (assetId: string) => void;
    export let onBuyAsset: (
        assetId: string,
        amount: number,
        price: number,
    ) => void;
    export let onSellAsset: (
        assetId: string,
        amount: number,
        price: number,
    ) => void;

    type SortOption = "value" | "change" | "name";
    let sortBy: SortOption = "value";
    let sortAscending = false;

    $: sortedAssets = [...assets].sort((a, b) => {
        let valueA: number | string;
        let valueB: number | string;

        switch (sortBy) {
            case "value":
                valueA = a.marketValue;
                valueB = b.marketValue;
                break;
            case "change":
                valueA = a.unrealizedGainPercent;
                valueB = b.unrealizedGainPercent;
                break;
            case "name":
                valueA = a.name.toLowerCase();
                valueB = b.name.toLowerCase();
                break;
            default:
                valueA = a.marketValue;
                valueB = b.marketValue;
        }

        if (typeof valueA === "string" && typeof valueB === "string") {
            return sortAscending
                ? valueA.localeCompare(valueB)
                : valueB.localeCompare(valueA);
        } else {
            const numA = Number(valueA);
            const numB = Number(valueB);
            return sortAscending ? numA - numB : numB - numA;
        }
    });

    function handleSortChange(newSortBy: SortOption) {
        if (sortBy === newSortBy) {
            sortAscending = !sortAscending;
        } else {
            sortBy = newSortBy;
            sortAscending = newSortBy === "name";
        }
    }
</script>

<div class="pt-4">
    <div class="mb-6">
        <!-- Header row with title and edit button -->
        <div class="flex justify-between items-center mb-4">
            <h2 class="text-lg font-light text-base-content/80">Your Assets</h2>
            <button
                class="text-sm text-base-content/60 hover:text-primary transition-colors duration-200 underline decoration-dotted underline-offset-4 hover:decoration-solid"
                on:click={onEdit}
            >
                {isEditMode ? "Done editing" : "Edit portfolio"}
            </button>
        </div>

        <!-- Sort controls row - responsive layout -->
        <div class="flex flex-wrap items-center gap-3 sm:gap-1">
            <span class="text-sm text-base-content/60 mr-2 hidden sm:inline"
                >Sort by:</span
            >
            <div class="flex items-center gap-1 flex-wrap">
                <button
                    class="px-2 py-1 text-sm transition-all duration-200 rounded-md {sortBy ===
                    'value'
                        ? 'text-primary font-medium'
                        : 'text-base-content/50 hover:text-base-content/80'}"
                    on:click={() => handleSortChange("value")}
                >
                    Value{#if sortBy === "value"}<span class="ml-1 text-xs"
                            >{sortAscending ? "↑" : "↓"}</span
                        >{/if}
                </button>
                <span class="text-base-content/30 hidden sm:inline">•</span>
                <button
                    class="px-2 py-1 text-sm transition-all duration-200 rounded-md {sortBy ===
                    'change'
                        ? 'text-primary font-medium'
                        : 'text-base-content/50 hover:text-base-content/80'}"
                    on:click={() => handleSortChange("change")}
                >
                    Change %{#if sortBy === "change"}<span class="ml-1 text-xs"
                            >{sortAscending ? "↑" : "↓"}</span
                        >{/if}
                </button>
                <span class="text-base-content/30 hidden sm:inline">•</span>
                <button
                    class="px-2 py-1 text-sm transition-all duration-200 rounded-md {sortBy ===
                    'name'
                        ? 'text-primary font-medium'
                        : 'text-base-content/50 hover:text-base-content/80'}"
                    on:click={() => handleSortChange("name")}
                >
                    Name{#if sortBy === "name"}<span class="ml-1 text-xs"
                            >{sortAscending ? "↑" : "↓"}</span
                        >{/if}
                </button>
            </div>
        </div>
    </div>
    <div
        class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8"
    >
        <!-- Add Asset Card - only visible in edit mode -->
        {#if isEditMode}
            <button
                class="border-2 border-dashed border-base-300 rounded-xl p-4 flex flex-col items-center justify-center h-32 hover:border-primary/50 hover:bg-primary/5 transition-all duration-200 group"
                on:click={onAddAsset}
            >
                <div
                    class="w-8 h-8 rounded-full bg-base-300/50 flex items-center justify-center mb-2 group-hover:bg-primary/20 transition-colors duration-200"
                >
                    <svg
                        class="w-4 h-4 text-base-content/40 group-hover:text-primary transition-colors duration-200"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M12 4v16m8-8H4"
                        />
                    </svg>
                </div>
                <span
                    class="text-xs text-base-content/60 group-hover:text-primary transition-colors duration-200"
                    >Add Asset</span
                >
            </button>
        {/if}

        {#each sortedAssets as asset (asset.id)}
            <AssetCard
                {asset}
                {isEditMode}
                onDelete={() => onDeleteAsset(asset.id)}
                onBuy={(amount: number, price: number) =>
                    onBuyAsset(asset.id, amount, price)}
                onSell={(amount: number, price: number) =>
                    onSellAsset(asset.id, amount, price)}
            />
        {/each}
    </div>
</div>
