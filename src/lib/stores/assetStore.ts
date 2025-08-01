import { writable, derived } from 'svelte/store';
import type { Asset, AssetSummary } from '../types/asset.js';

const sampleAssets: Asset[] = [
    {
        id: '1',
        type: 'stock',
        name: 'Apple Inc.',
        symbol: 'AAPL',
        purchases: [
            { quantity: 10, pricePerUnit: 150.55, date: new Date('2024-01-15') }
        ],
        currentPrice: 160.55,
        quantity: 10,
        marketValue: 1605.50,
        totalCostBasis: 1505.50,
        unrealizedGain: 100.00,
        unrealizedGainPercent: 6.64,
        lastUpdated: new Date()
    },
    {
        id: '2',
        type: 'crypto',
        name: 'Bitcoin',
        symbol: 'BTC',
        purchases: [
            { quantity: 0.5, pricePerUnit: 35000, date: new Date('2024-02-01') }
        ],
        currentPrice: 39300.00,
        quantity: 0.5,
        marketValue: 19650.00,
        totalCostBasis: 17500.00,
        unrealizedGain: 2150.00,
        unrealizedGainPercent: 12.29,
        lastUpdated: new Date()
    },
    {
        id: '3',
        type: 'stock',
        name: 'ASML Holding',
        symbol: 'ASML',
        purchases: [
            { quantity: 3, pricePerUnit: 720.00, date: new Date('2024-01-20') }
        ],
        currentPrice: 700.00,
        quantity: 3,
        marketValue: 2100.00,
        totalCostBasis: 2160.00,
        unrealizedGain: -60.00,
        unrealizedGainPercent: -2.78,
        lastUpdated: new Date()
    },
    {
        id: '4',
        type: 'metal',
        name: 'Gold',
        symbol: 'XAU',
        purchases: [
            { quantity: 2, pricePerUnit: 1850.00, date: new Date('2024-03-01') }
        ],
        currentPrice: 1875.00,
        quantity: 2,
        marketValue: 3750.00,
        totalCostBasis: 3700.00,
        unrealizedGain: 50.00,
        unrealizedGainPercent: 1.35,
        lastUpdated: new Date()
    },
    {
        id: '5',
        type: 'crypto',
        name: 'Ethereum',
        symbol: 'ETH',
        purchases: [
            { quantity: 3, pricePerUnit: 2100.00, date: new Date('2024-02-15') }
        ],
        currentPrice: 2190.00,
        quantity: 3,
        marketValue: 6570.00,
        totalCostBasis: 6300.00,
        unrealizedGain: 270.00,
        unrealizedGainPercent: 4.29,
        lastUpdated: new Date()
    },
    {
        id: '6',
        type: 'custom',
        name: 'Emergency Fund',
        symbol: 'CASH',
        purchases: [
            { quantity: 1, pricePerUnit: 4500.00, date: new Date('2024-01-01') }
        ],
        priceOverride: 4500.00,
        quantity: 1,
        marketValue: 4500.00,
        totalCostBasis: 4500.00,
        unrealizedGain: 0,
        unrealizedGainPercent: 0,
        lastUpdated: new Date()
    }
];

export const assets = writable<Asset[]>(sampleAssets);

export const assetSummary = derived(assets, ($assets): AssetSummary => {
    const totalMarketValue = $assets.reduce((sum, asset) => sum + asset.marketValue, 0);
    const totalCostBasis = $assets.reduce((sum, asset) => sum + asset.totalCostBasis, 0);
    const totalUnrealizedGain = totalMarketValue - totalCostBasis;
    const totalUnrealizedGainPercent = totalCostBasis > 0 ? (totalUnrealizedGain / totalCostBasis) * 100 : 0;

    const byType = {
        stock: $assets.filter(a => a.type === 'stock').reduce((sum, asset) => sum + asset.marketValue, 0),
        crypto: $assets.filter(a => a.type === 'crypto').reduce((sum, asset) => sum + asset.marketValue, 0),
        metal: $assets.filter(a => a.type === 'metal').reduce((sum, asset) => sum + asset.marketValue, 0),
        custom: $assets.filter(a => a.type === 'custom').reduce((sum, asset) => sum + asset.marketValue, 0)
    };

    const unrealizedGainsByType = {
        stock: $assets.filter(a => a.type === 'stock').reduce((sum, asset) => sum + asset.unrealizedGain, 0),
        crypto: $assets.filter(a => a.type === 'crypto').reduce((sum, asset) => sum + asset.unrealizedGain, 0),
        metal: $assets.filter(a => a.type === 'metal').reduce((sum, asset) => sum + asset.unrealizedGain, 0),
        custom: $assets.filter(a => a.type === 'custom').reduce((sum, asset) => sum + asset.unrealizedGain, 0)
    };

    const costBasisByType = {
        stock: $assets.filter(a => a.type === 'stock').reduce((sum, asset) => sum + asset.totalCostBasis, 0),
        crypto: $assets.filter(a => a.type === 'crypto').reduce((sum, asset) => sum + asset.totalCostBasis, 0),
        metal: $assets.filter(a => a.type === 'metal').reduce((sum, asset) => sum + asset.totalCostBasis, 0),
        custom: $assets.filter(a => a.type === 'custom').reduce((sum, asset) => sum + asset.totalCostBasis, 0)
    };

    const unrealizedGainsPercentByType = {
        stock: costBasisByType.stock > 0 ? (unrealizedGainsByType.stock / costBasisByType.stock) * 100 : 0,
        crypto: costBasisByType.crypto > 0 ? (unrealizedGainsByType.crypto / costBasisByType.crypto) * 100 : 0,
        metal: costBasisByType.metal > 0 ? (unrealizedGainsByType.metal / costBasisByType.metal) * 100 : 0,
        custom: costBasisByType.custom > 0 ? (unrealizedGainsByType.custom / costBasisByType.custom) * 100 : 0
    };

    return {
        totalMarketValue,
        totalCostBasis,
        totalUnrealizedGain,
        totalUnrealizedGainPercent,
        byType,
        unrealizedGainsByType,
        unrealizedGainsPercentByType
    };
});
