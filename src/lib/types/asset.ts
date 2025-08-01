export type AssetType = 'stock' | 'crypto' | 'metal' | 'custom';

export interface Purchase {
    quantity: number;
    pricePerUnit: number;
    date: Date;
}

export interface Asset {
    id: string;
    type: AssetType;
    name: string;
    symbol: string;

    // Current holdings (FIFO queue of purchases)
    purchases: Purchase[]; // What you currently own

    // Current market data
    currentPrice?: number; // Current market price per unit

    // Calculated fields (derived from purchases + current price)
    quantity: number; // Total quantity held
    marketValue: number; // quantity * currentPrice
    totalCostBasis: number; // Sum of all purchase costs
    unrealizedGain: number; // marketValue - totalCostBasis
    unrealizedGainPercent: number; // (unrealizedGain / totalCostBasis) * 100

    lastUpdated?: Date;
    priceOverride?: number; // For custom assets
}

export interface AssetSummary {
    totalMarketValue: number;
    totalCostBasis: number;
    totalUnrealizedGain: number;
    totalUnrealizedGainPercent: number;

    // Breakdown by asset type
    byType: {
        stock: number;
        crypto: number;
        metal: number;
        custom: number;
    };

    // Unrealized gains by type (absolute amounts)
    unrealizedGainsByType: {
        stock: number;
        crypto: number;
        metal: number;
        custom: number;
    };

    // Unrealized gains by type (percentages)
    unrealizedGainsPercentByType: {
        stock: number;
        crypto: number;
        metal: number;
        custom: number;
    };
}

// Simple utility functions
export class AssetCalculator {
    /**
     * Add a purchase to the asset
     */
    static addPurchase(asset: Asset, quantity: number, pricePerUnit: number): void {
        asset.purchases.push({
            quantity,
            pricePerUnit,
            date: new Date()
        });
        this.updateCalculatedFields(asset);
    }

    /**
     * Sell quantity using FIFO - removes from oldest purchases first
     */
    static sell(asset: Asset, quantityToSell: number): number {
        let remainingToSell = quantityToSell;
        let totalSaleValue = 0;

        while (remainingToSell > 0 && asset.purchases.length > 0) {
            const oldestPurchase = asset.purchases[0];
            const quantityFromThisPurchase = Math.min(remainingToSell, oldestPurchase.quantity);

            totalSaleValue += quantityFromThisPurchase * oldestPurchase.pricePerUnit;
            oldestPurchase.quantity -= quantityFromThisPurchase;
            remainingToSell -= quantityFromThisPurchase;

            if (oldestPurchase.quantity === 0) {
                asset.purchases.shift(); // Remove empty purchase
            }
        }

        this.updateCalculatedFields(asset);
        return totalSaleValue; // Cost basis of what was sold
    }

    /**
     * Update all calculated fields based on current purchases and market price
     */
    static updateCalculatedFields(asset: Asset): void {
        asset.quantity = asset.purchases.reduce((sum, p) => sum + p.quantity, 0);
        asset.totalCostBasis = asset.purchases.reduce((sum, p) => sum + (p.quantity * p.pricePerUnit), 0);

        const currentPrice = asset.currentPrice || asset.priceOverride || 0;
        asset.marketValue = asset.quantity * currentPrice;
        asset.unrealizedGain = asset.marketValue - asset.totalCostBasis;
        asset.unrealizedGainPercent = asset.totalCostBasis > 0 ? (asset.unrealizedGain / asset.totalCostBasis) * 100 : 0;
    }
}
