
export function formatCurrency(amount: number): string {
    return new Intl.NumberFormat('de-DE', {
        style: 'currency',
        currency: 'EUR'
    }).format(amount);
}

export function formatPercent(percent: number): string {
    return (percent >= 0 ? '+' : '') + percent.toFixed(2) + '%';
}

