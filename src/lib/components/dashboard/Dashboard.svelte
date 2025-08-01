<script lang="ts">
    import { assets, assetSummary } from "$lib/stores/assetStore.js";
    import AssetGrid from "./AssetGrid.svelte";
    import PortfolioSummary from "./PortfolioSummary.svelte";

    function handleEdit() {
        console.log("Edit mode");
    }
</script>

<div class="p-8 max-w-6xl mx-auto">
    <!-- Portfolio Summary Section -->
    <div class="mb-12 py-8">
        <PortfolioSummary summary={$assetSummary} />
    </div>

    <!-- Assets Grid Section -->
    <AssetGrid assets={$assets} onEdit={handleEdit} />
</div>
