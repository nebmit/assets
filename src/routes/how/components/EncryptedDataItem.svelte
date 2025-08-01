<script lang="ts">
    export let title: string;
    export let data: string;
    export let label: string;

    function viewData() {
        const blob = new Blob([data], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank");
        setTimeout(() => URL.revokeObjectURL(url), 100);
    }
</script>

<div>
    <div class="flex items-center justify-between mb-2">
        <h4 class="text-sm font-medium text-base-content">
            {title}
        </h4>
        <button
            class="btn btn-xs btn-ghost hover:btn-primary transition-colors duration-200"
            aria-label="View {label} in new window"
            on:click={viewData}
        >
            <svg
                class="w-3 h-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
            >
                <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                />
            </svg>
        </button>
    </div>
    <div
        class="bg-base-100 rounded-md p-3 font-mono text-xs text-base-content/70 break-all border border-base-300/30 hover:border-base-300/50 transition-colors duration-200"
        style="display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;"
    >
        {data}
    </div>
</div>
