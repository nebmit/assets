<script lang="ts">
    import type { Asset } from "../types/asset.js";
    import { formatCurrency, formatPercent } from "../utils/format.js";

    export let asset: Asset;
</script>

<div
    class="group p-5 rounded-xl border border-base-300 bg-base-200 hover:border-primary/30 transition-all duration-300 hover:shadow-xl hover:shadow-primary/5 hover:bg-base-200/80 cursor-pointer"
>
    <div class="flex justify-between items-start mb-4">
        <div>
            <div
                class="font-medium text-base text-base-content group-hover:text-primary transition-colors duration-300"
            >
                {asset.symbol}
            </div>
            <div class="text-sm opacity-70 text-base-content">{asset.name}</div>
        </div>
        <div class="text-right">
            <div class="font-light text-xl text-base-content">
                {formatCurrency(asset.marketValue)}
            </div>
            {#if asset.unrealizedGainPercent !== undefined && !asset.priceOverride}
                <div
                    class="text-sm font-medium {asset.unrealizedGain >= 0
                        ? 'text-success'
                        : 'text-error'}"
                >
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
