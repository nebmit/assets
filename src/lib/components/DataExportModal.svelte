<script lang="ts">
    import { createEventDispatcher } from "svelte";

    const dispatch = createEventDispatcher();

    export let isOpen = false;

    let selectedFormat = "json";
    let includeHistory = true;
    let isExporting = false;

    const exportFormats = [
        {
            value: "json",
            label: "JSON",
            description: "Machine-readable format for backup",
        },
        {
            value: "csv",
            label: "CSV",
            description: "Spreadsheet-compatible format",
        },
    ];

    function closeModal() {
        isOpen = false;
        dispatch("close");
    }

    async function handleExport() {
        isExporting = true;

        try {
            // TODO: Implement export process
            await new Promise((resolve) => setTimeout(resolve, 2000));

            // Create mock export data
            const exportData = {
                exportedAt: new Date().toISOString(),
                format: selectedFormat,
                includeHistory,
                portfolio: {
                    totalValue: 125840.32,
                    assets: [
                        { symbol: "AAPL", shares: 50, currentPrice: 175.23 },
                        { symbol: "BTC", amount: 0.5, currentPrice: 43250.0 },
                    ],
                },
            };

            const filename = `portfolio-export-${new Date().toISOString().split("T")[0]}.${selectedFormat}`;
            let content = "";
            let mimeType = "application/json";

            switch (selectedFormat) {
                case "json":
                    content = JSON.stringify(exportData, null, 2);
                    mimeType = "application/json";
                    break;
                case "csv":
                    content = "Symbol,Type,Amount,Current Price,Value\n";
                    exportData.portfolio.assets.forEach((asset) => {
                        const amount = asset.shares || asset.amount || 0;
                        const value = amount * asset.currentPrice;
                        content += `${asset.symbol},${asset.shares ? "Stock" : "Crypto"},${amount},${asset.currentPrice},${value}\n`;
                    });
                    mimeType = "text/csv";
                    break;
            }

            const blob = new Blob([content], { type: mimeType });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);

            closeModal();
        } catch (error) {
            console.error("Export failed:", error);
        } finally {
            isExporting = false;
        }
    }

    function handleBackdropClick(event: MouseEvent) {
        if (event.target === event.currentTarget) {
            closeModal();
        }
    }
</script>

{#if isOpen}
    <!-- Modal Backdrop -->
    <div
        class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
        role="dialog"
        aria-labelledby="export-modal-title"
        aria-modal="true"
        tabindex="-1"
        on:click={handleBackdropClick}
        on:keydown={(e) => e.key === "Escape" && closeModal()}
    >
        <!-- Modal Content -->
        <div
            class="bg-base-100 rounded-xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto"
        >
            <!-- Header -->
            <div class="p-6 border-b border-base-300/30">
                <div class="flex items-center justify-between">
                    <h2
                        id="export-modal-title"
                        class="text-xl font-medium text-base-content"
                    >
                        Export Portfolio Data
                    </h2>
                    <button
                        class="p-1 hover:bg-base-200 rounded-lg transition-colors"
                        aria-label="Close modal"
                        on:click={closeModal}
                    >
                        <svg
                            class="w-5 h-5 text-base-content/60"
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
                <p class="text-sm text-base-content/60 mt-2">
                    Export your portfolio data in your preferred format
                </p>
            </div>

            <!-- Form -->
            <div class="p-6 space-y-6">
                <!-- Format Selection -->
                <div>
                    <div
                        class="block text-sm font-medium text-base-content mb-3"
                    >
                        Export Format
                    </div>
                    <div class="space-y-3">
                        {#each exportFormats as format}
                            <label
                                class="flex items-start gap-3 p-3 border border-base-300/50 rounded-lg hover:bg-base-200/30 cursor-pointer transition-colors"
                            >
                                <input
                                    type="radio"
                                    bind:group={selectedFormat}
                                    value={format.value}
                                    class="radio radio-primary radio-sm mt-0.5"
                                />
                                <div>
                                    <div class="font-medium text-base-content">
                                        {format.label}
                                    </div>
                                    <div class="text-xs text-base-content/60">
                                        {format.description}
                                    </div>
                                </div>
                            </label>
                        {/each}
                    </div>
                </div>

                <!-- Options -->
                <div>
                    <div
                        class="block text-sm font-medium text-base-content mb-3"
                    >
                        Export Options
                    </div>
                    <label
                        class="flex items-center gap-3 p-3 border border-base-300/50 rounded-lg hover:bg-base-200/30 cursor-pointer transition-colors"
                    >
                        <input
                            type="checkbox"
                            bind:checked={includeHistory}
                            class="checkbox checkbox-primary checkbox-sm"
                        />
                        <div>
                            <div class="font-medium text-base-content">
                                Include Historical Data
                            </div>
                            <div class="text-xs text-base-content/60">
                                Export price history and transaction records
                            </div>
                        </div>
                    </label>
                </div>

                <!-- Security Notice -->
                <div
                    class="bg-warning/10 border border-warning/20 rounded-lg p-4"
                >
                    <div class="flex items-start gap-3">
                        <svg
                            class="w-4 h-4 text-warning flex-shrink-0 mt-0.5"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
                            />
                        </svg>
                        <div>
                            <div class="text-sm font-medium text-warning">
                                Security Notice
                            </div>
                            <div class="text-xs text-base-content/60 mt-1">
                                Exported data will be unencrypted. Store the
                                file securely and delete it when no longer
                                needed.
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Footer -->
            <div class="p-6 border-t border-base-300/30 flex gap-3 justify-end">
                <button
                    class="px-4 py-2 text-sm text-base-content/60 hover:text-base-content transition-colors"
                    on:click={closeModal}
                    disabled={isExporting}
                >
                    Cancel
                </button>
                <button
                    class="px-6 py-2 bg-primary text-primary-content rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    on:click={handleExport}
                    disabled={isExporting}
                >
                    {#if isExporting}
                        <svg
                            class="w-4 h-4 animate-spin"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                            />
                        </svg>
                        Exporting...
                    {:else}
                        <svg
                            class="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10"
                            />
                        </svg>
                        Export Data
                    {/if}
                </button>
            </div>
        </div>
    </div>
{/if}
