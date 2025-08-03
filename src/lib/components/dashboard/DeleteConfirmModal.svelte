<script lang="ts">
    export let isOpen = false;
    export let assetName: string;
    export let onConfirm: () => void;
    export let onCancel: () => void;

    function handleModalClick(event: MouseEvent) {
        if (event.target === event.currentTarget) {
            onCancel();
        }
    }

    function handleKeydown(event: KeyboardEvent) {
        if (event.key === "Escape") {
            onCancel();
        }
    }
</script>

{#if isOpen}
    <div
        class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-in fade-in duration-200 p-4"
        on:click={handleModalClick}
        on:keydown={handleKeydown}
        role="dialog"
        aria-modal="true"
        tabindex="-1"
    >
        <div
            class="bg-base-200 rounded-xl p-6 max-w-sm w-full animate-in zoom-in-95 duration-200"
        >
            <h3 class="text-lg font-medium text-base-content mb-2">
                Delete Asset
            </h3>
            <p class="text-sm text-base-content/70 mb-6">
                Are you sure you want to delete <strong>{assetName}</strong>?
                This action cannot be undone.
            </p>
            <div class="flex gap-3 justify-end">
                <button
                    class="px-4 py-2 text-sm border border-base-300 rounded-lg hover:bg-base-300/30 transition-colors"
                    on:click={onCancel}
                >
                    Cancel
                </button>
                <button
                    class="px-4 py-2 text-sm bg-error text-error-content rounded-lg hover:bg-error/90 transition-colors"
                    on:click={onConfirm}
                >
                    Delete
                </button>
            </div>
        </div>
    </div>
{/if}
