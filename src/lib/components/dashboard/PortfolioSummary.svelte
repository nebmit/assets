<script lang="ts">
    import type { AssetSummary } from "../../types/asset.js";
    import { formatCurrency, formatPercent } from "../../utils/format.js";

    export let summary: AssetSummary;

    // Asset type display configuration
    const assetTypeConfig = {
        stock: { label: "Stocks" },
        crypto: { label: "Crypto" },
        metal: { label: "Metals" },
        custom: { label: "Custom" },
    };

    // Filter out asset types with zero value
    $: activeAssetTypes = Object.entries(summary.byType)
        .filter(([_, value]) => value > 0)
        .map(([type, value]) => ({
            type: type as keyof typeof summary.byType,
            value,
            gain: summary.unrealizedGainsByType[
                type as keyof typeof summary.unrealizedGainsByType
            ],
            gainPercent:
                summary.unrealizedGainsPercentByType[
                    type as keyof typeof summary.unrealizedGainsPercentByType
                ],
            config: assetTypeConfig[type as keyof typeof assetTypeConfig],
            showGain: type !== "custom", // Don't show gains for custom assets
        }));
</script>

<div class="text-left">
    <!-- Main total value and change -->
    <div class="flex flex-col lg:flex-row lg:items-end lg:gap-8 mb-4">
        <!-- Total Value -->
        <div class="flex-shrink-0">
            <div
                class="text-5xl font-extralight mb-3 text-base-content tracking-wide"
            >
                {formatCurrency(summary.totalMarketValue)}
            </div>
            <div class="flex items-center gap-2">
                <div
                    class="text-base {summary.totalUnrealizedGain >= 0
                        ? 'text-success'
                        : 'text-error'}"
                >
                    {formatCurrency(summary.totalUnrealizedGain)} ({formatPercent(
                        summary.totalUnrealizedGainPercent,
                    )})
                </div>
                {#if summary.totalUnrealizedGain >= 0}
                    <div
                        class="w-0 h-0 border-l-2 border-r-2 border-b-3 border-l-transparent border-r-transparent border-b-success"
                    ></div>
                {:else}
                    <div
                        class="w-0 h-0 border-l-2 border-r-2 border-t-3 border-l-transparent border-r-transparent border-t-error"
                    ></div>
                {/if}
            </div>
        </div>

        <!-- Asset Type Breakdown -->
        {#if activeAssetTypes.length > 0}
            <div class="flex-1 mt-4 lg:mt-0">
                <!-- Desktop: Single row, aligned to bottom -->
                <div class="hidden lg:flex lg:gap-8">
                    {#each activeAssetTypes as { type, value, gain, gainPercent, config, showGain }}
                        <div class="flex flex-col">
                            <div
                                class="text-xs text-base-content/60 leading-tight mb-1"
                            >
                                {config.label}
                            </div>
                            <div
                                class="text-sm font-normal text-base-content mb-0.5"
                            >
                                {formatCurrency(value)}
                            </div>
                            {#if showGain}
                                <div
                                    class="text-xs {gain >= 0
                                        ? 'text-success'
                                        : 'text-error'}"
                                >
                                    {gain >= 0 ? "+" : ""}{formatCurrency(gain)}
                                    ({formatPercent(gainPercent)})
                                </div>
                            {/if}
                        </div>
                    {/each}
                </div>

                <!-- Mobile: Vertical stack -->
                <div class="lg:hidden">
                    <div class="text-xs text-base-content/60 mb-3">
                        Asset Breakdown
                    </div>
                    <div class="grid grid-cols-2 gap-3">
                        {#each activeAssetTypes as { type, value, gain, gainPercent, config, showGain }}
                            <div class="bg-base-200/30 rounded-lg p-3">
                                <div
                                    class="text-xs text-base-content/60 leading-tight mb-1"
                                >
                                    {config.label}
                                </div>
                                <div
                                    class="text-sm font-medium text-base-content mb-1"
                                >
                                    {formatCurrency(value)}
                                </div>
                                {#if showGain}
                                    <div
                                        class="text-xs {gain >= 0
                                            ? 'text-success'
                                            : 'text-error'}"
                                    >
                                        {gain >= 0 ? "+" : ""}{formatCurrency(
                                            gain,
                                        )} ({formatPercent(gainPercent)})
                                    </div>
                                {/if}
                            </div>
                        {/each}
                    </div>
                </div>
            </div>
        {/if}
    </div>
</div>
