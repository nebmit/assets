<script lang="ts">
    import type { Asset } from "$lib/types/asset.js";
    import { formatCurrency, formatPercent } from "$lib/utils/format.js";
    import AssetCardControls from "./AssetCardControls.svelte";
    import TransactionModal from "./TransactionModal.svelte";
    import DeleteConfirmModal from "./DeleteConfirmModal.svelte";

    export let asset: Asset;
    export let isEditMode: boolean = false;
    export let onDelete: (() => void) | undefined = undefined;
    export let onBuy: ((amount: number, price: number) => void) | undefined =
        undefined;
    export let onSell: ((amount: number, price: number) => void) | undefined =
        undefined;

    let showDeleteConfirm = false;
    let showTradeModal = false;

    // Computed values
    $: isProfitable = asset.unrealizedGain >= 0;
    $: gainLossClass = isProfitable ? "text-success" : "text-error";

    // Event handlers
    function handleEdit() {
        showTradeModal = true;
    }

    function handleDelete() {
        showDeleteConfirm = true;
    }

    function confirmDelete() {
        onDelete?.();
        showDeleteConfirm = false;
    }

    function cancelDelete() {
        showDeleteConfirm = false;
    }

    function handleBuy(amount: number, price: number) {
        onBuy?.(amount, price);
    }

    function handleSell(amount: number, price: number) {
        onSell?.(amount, price);
    }

    function closeTradeModal() {
        showTradeModal = false;
    }
</script>

<!-- Asset Card -->
<div
    class="group rounded-xl border border-base-300 bg-base-200 hover:border-primary/30 transition-all duration-300 hover:shadow-xl hover:shadow-primary/5 hover:bg-base-200/80 overflow-hidden"
>
    <!-- Main Card Content -->
    <div
        class="p-5"
        class:cursor-default={isEditMode}
        class:cursor-pointer={!isEditMode}
    >
        <div class="flex justify-between items-start mb-4">
            <!-- Asset Info -->
            <div class="flex-1">
                <div
                    class="font-medium text-base text-base-content group-hover:text-primary transition-colors duration-300"
                >
                    {asset.symbol}
                </div>
                <div class="text-sm opacity-70 text-base-content">
                    {asset.name}
                </div>
            </div>

            <!-- Value Display -->
            <div class="text-right">
                <div class="font-light text-xl text-base-content">
                    {formatCurrency(asset.marketValue)}
                </div>
                {#if asset.unrealizedGainPercent !== undefined && !asset.priceOverride}
                    <div class="text-sm font-medium {gainLossClass}">
                        {asset.unrealizedGain >= 0 ? "+" : ""}{formatCurrency(
                            asset.unrealizedGain,
                        )}
                        ({formatPercent(asset.unrealizedGainPercent)})
                    </div>
                {:else if asset.priceOverride}
                    <div class="text-sm font-light text-primary/80 italic">
                        price override
                    </div>
                {/if}
            </div>
        </div>

        <!-- Bottom Row -->
        <div class="flex justify-between items-end">
            <!-- Asset Details -->
            <div>
                {#if !asset.priceOverride}
                    <div class="text-sm opacity-60 text-base-content">
                        {asset.quantity}
                        {asset.quantity === 1 ? "unit" : "units"}
                        {#if asset.currentPrice}
                            @ {formatCurrency(asset.currentPrice)}
                        {/if}
                    </div>
                {/if}
            </div>

            <!-- Edit Mode Controls -->
            {#if isEditMode}
                <AssetCardControls
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                />
            {/if}
        </div>
    </div>
</div>

<!-- Modals -->
<TransactionModal
    isOpen={showTradeModal}
    {asset}
    onBuy={handleBuy}
    onSell={handleSell}
    onClose={closeTradeModal}
/>

<DeleteConfirmModal
    isOpen={showDeleteConfirm}
    assetName={asset.name}
    onConfirm={confirmDelete}
    onCancel={cancelDelete}
/>
