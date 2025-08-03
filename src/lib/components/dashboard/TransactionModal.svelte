<script lang="ts">
    import type { Asset } from "$lib/types/asset.js";
    import { formatCurrency } from "$lib/utils/format.js";

    export let isOpen = false;
    export let asset: Asset;
    export let onBuy: (amount: number, price: number) => void;
    export let onSell: (amount: number, price: number) => void;
    export let onClose: () => void;

    let transactionType: "buy" | "sell" = "buy";
    let amount = 0;
    let price = 0;

    // Computed values
    $: isBuyTransaction = transactionType === "buy";
    $: hasValidTransaction = amount > 0 && price > 0;
    $: totalTransactionValue = amount * price;
    $: isValidSellAmount =
        transactionType === "sell" ? amount <= asset.quantity : true;
    $: canSubmitTransaction = hasValidTransaction && isValidSellAmount;

    // UI state classes
    $: transactionButtonClass = isBuyTransaction
        ? "bg-success text-success-content hover:bg-success/90"
        : "bg-error text-error-content hover:bg-error/90";
    $: transactionPreviewClass = isBuyTransaction
        ? "bg-success/10 border-success/20"
        : "bg-error/10 border-error/20";
    $: transactionFocusClass = isBuyTransaction
        ? "focus:border-success"
        : "focus:border-error";

    function handleBuy() {
        if (canSubmitTransaction) {
            onBuy(amount, price);
            resetAndClose();
        }
    }

    function handleSell() {
        if (canSubmitTransaction) {
            onSell(amount, price);
            resetAndClose();
        }
    }

    function resetAndClose() {
        amount = 0;
        price = 0;
        transactionType = "buy";
        onClose();
    }

    function handleModalClick(event: MouseEvent) {
        if (event.target === event.currentTarget) {
            resetAndClose();
        }
    }

    function handleKeydown(event: KeyboardEvent) {
        if (event.key === "Escape") {
            resetAndClose();
        }
    }
</script>

{#if isOpen}
    <div
        class="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 animate-in fade-in duration-200"
        on:click={handleModalClick}
        on:keydown={handleKeydown}
        role="dialog"
        aria-modal="true"
        tabindex="-1"
    >
        <!-- Mobile: Bottom sheet, Desktop: Centered modal -->
        <div
            class="bg-base-200 w-full sm:w-auto sm:max-w-md sm:mx-4 sm:rounded-xl overflow-hidden animate-in slide-in-from-bottom sm:zoom-in-95 duration-200"
        >
            <!-- Header -->
            <div
                class="flex justify-between items-center p-4 border-b border-base-300/50"
            >
                <div class="flex-1">
                    <h3 class="text-lg font-medium text-base-content">
                        Log Transaction
                    </h3>
                    <p class="text-sm text-base-content/60">
                        Record transaction for {asset.symbol}
                    </p>
                </div>
                <button
                    class="p-2 hover:bg-base-300/50 rounded-lg transition-colors flex-shrink-0"
                    on:click={resetAndClose}
                    aria-label="Close modal"
                >
                    <svg
                        class="w-5 h-5"
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
            </div>

            <!-- Content -->
            <div class="p-4">
                <!-- Transaction Type Toggle -->
                <div class="flex bg-base-300/30 rounded-lg p-1 mb-6">
                    <button
                        class="flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors {isBuyTransaction
                            ? 'bg-success text-success-content shadow-sm'
                            : 'text-base-content/70 hover:text-base-content'}"
                        on:click={() => (transactionType = "buy")}
                    >
                        Purchase
                    </button>
                    <button
                        class="flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors {!isBuyTransaction
                            ? 'bg-error text-error-content shadow-sm'
                            : 'text-base-content/70 hover:text-base-content'}"
                        on:click={() => (transactionType = "sell")}
                    >
                        Sale
                    </button>
                </div>

                <!-- Transaction Form -->
                <div class="space-y-4">
                    <div>
                        <label
                            for="amount-{asset.id}"
                            class="block text-sm font-medium text-base-content/80 mb-2"
                        >
                            {isBuyTransaction
                                ? "Amount purchased"
                                : "Amount sold"}
                        </label>
                        <input
                            id="amount-{asset.id}"
                            type="number"
                            placeholder={isBuyTransaction ? "10" : "5"}
                            bind:value={amount}
                            max={transactionType === "sell"
                                ? asset.quantity
                                : undefined}
                            class="w-full px-4 py-3 text-base border border-base-300 rounded-lg bg-base-100 {transactionFocusClass} focus:outline-none transition-colors"
                        />
                        <div class="text-sm text-base-content/60 mt-1 h-5">
                            {#if transactionType === "sell"}
                                Maximum: {asset.quantity} units available
                            {/if}
                        </div>
                    </div>

                    <div>
                        <label
                            for="price-{asset.id}"
                            class="block text-sm font-medium text-base-content/80 mb-2"
                        >
                            Price per unit
                        </label>
                        <input
                            id="price-{asset.id}"
                            type="number"
                            placeholder={isBuyTransaction ? "150.00" : "175.00"}
                            bind:value={price}
                            step="0.01"
                            class="w-full px-4 py-3 text-base border border-base-300 rounded-lg bg-base-100 {transactionFocusClass} focus:outline-none transition-colors"
                        />
                    </div>

                    <!-- Transaction Preview -->
                    {#if hasValidTransaction}
                        <div class="p-3 rounded-lg {transactionPreviewClass}">
                            <div class="text-sm text-base-content/80">
                                <div class="flex justify-between">
                                    <span
                                        >{isBuyTransaction
                                            ? "Total cost:"
                                            : "Total proceeds:"}</span
                                    >
                                    <span class="font-medium"
                                        >{formatCurrency(
                                            totalTransactionValue,
                                        )}</span
                                    >
                                </div>
                                <div class="flex justify-between mt-1">
                                    <span>Units:</span>
                                    <span>{amount}</span>
                                </div>
                                <div class="flex justify-between mt-1">
                                    <span>Price per unit:</span>
                                    <span>{formatCurrency(price)}</span>
                                </div>
                            </div>
                        </div>
                    {/if}

                    <button
                        class="w-full px-4 py-3 text-base font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed {transactionButtonClass}"
                        on:click={isBuyTransaction ? handleBuy : handleSell}
                        disabled={!canSubmitTransaction}
                    >
                        Record {isBuyTransaction ? "Purchase" : "Sale"}
                    </button>
                </div>

                <!-- Current Holdings Info -->
                <div class="mt-6 pt-4 border-t border-base-300/50">
                    <div class="text-sm text-base-content/60 space-y-2">
                        <div class="flex justify-between">
                            <span>Current holdings:</span>
                            <span class="font-medium"
                                >{asset.quantity} units</span
                            >
                        </div>
                        <div class="flex justify-between">
                            <span>Current price:</span>
                            <span class="font-medium"
                                >{formatCurrency(asset.currentPrice || 0)}</span
                            >
                        </div>
                        <div
                            class="flex justify-between text-base font-medium text-base-content"
                        >
                            <span>Total value:</span>
                            <span>{formatCurrency(asset.marketValue)}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
{/if}
