<script lang="ts">
    import { assets, assetSummary } from "$lib/stores/assetStore.js";
    import AssetGrid from "./AssetGrid.svelte";
    import PortfolioSummary from "./PortfolioSummary.svelte";

    let isEditMode = false;

    function handleEdit() {
        isEditMode = !isEditMode;
    }

    function handleAddAsset() {
        console.log("Add new asset");
        // TODO: Implement add new asset functionality
    }

    function handleDeleteAsset(assetId: string) {
        console.log("Delete asset:", assetId);
        // TODO: Implement delete asset functionality
    }

    function handleBuyAsset(assetId: string, amount: number, price: number) {
        console.log("Buy asset:", assetId, amount, price);
        // TODO: Implement buy asset functionality
    }

    function handleSellAsset(assetId: string, amount: number, price: number) {
        console.log("Sell asset:", assetId, amount, price);
        // TODO: Implement sell asset functionality
    }
</script>

<div class="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
    <!-- Portfolio Summary Section -->
    <div class="mb-8 sm:mb-12 py-4 sm:py-8">
        <PortfolioSummary summary={$assetSummary} />
    </div>

    <!-- Assets Grid Section -->
    <AssetGrid
        assets={$assets}
        {isEditMode}
        onEdit={handleEdit}
        onAddAsset={handleAddAsset}
        onDeleteAsset={handleDeleteAsset}
        onBuyAsset={handleBuyAsset}
        onSellAsset={handleSellAsset}
    />
</div>
