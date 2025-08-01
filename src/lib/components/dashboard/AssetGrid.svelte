<script lang="ts">
    import type { Asset } from "$lib/types/asset.js";
    import AssetCard from "../AssetCard.svelte";

    export let assets: Asset[];
    export let onEdit: () => void;

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
    <div class="flex justify-between items-center mb-6">
        <div class="flex items-center gap-6">
            <h2 class="text-lg font-light text-base-content/80">Your Assets</h2>
            <!-- Clean Sort Toggle Buttons -->
            <div class="flex items-center gap-1">
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
                <span class="text-base-content/30">•</span>
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
                <span class="text-base-content/30">•</span>
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
        <button
            class="text-sm text-base-content/60 hover:text-primary transition-colors duration-200 underline decoration-dotted underline-offset-4 hover:decoration-solid"
            on:click={onEdit}
        >
            Edit portfolio
        </button>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {#each sortedAssets as asset (asset.id)}
            <AssetCard {asset} />
        {/each}
    </div>
</div>
