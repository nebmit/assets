<script lang="ts">
    export let onEdit: () => void;
    export let onDelete: () => void;
</script>

<div class="flex items-center gap-2">
    <button
        class="p-1.5 rounded-lg hover:bg-primary/10 transition-colors duration-200"
        on:click={onEdit}
        aria-label="Log transaction"
    >
        <svg
            class="w-4 h-4 text-base-content/60 hover:text-primary"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
        >
            <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4"
            />
        </svg>
    </button>
    <button
        class="p-1.5 rounded-lg hover:bg-error/10 transition-colors duration-200"
        on:click={onDelete}
        aria-label="Delete asset"
    >
        <svg
            class="w-4 h-4 text-base-content/60 hover:text-error"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
        >
            <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
        </svg>
    </button>
</div>
