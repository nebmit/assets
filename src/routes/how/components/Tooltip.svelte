<script lang="ts">
    export let term: string;
    export let definition: string;

    let isVisible = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    function showTooltip() {
        clearTimeout(timeoutId);
        isVisible = true;
    }

    function hideTooltip() {
        timeoutId = setTimeout(() => {
            isVisible = false;
        }, 150); // Small delay to prevent flickering
    }

    function toggleTooltip() {
        isVisible = !isVisible;
    }

    function handleKeyDown(event: KeyboardEvent) {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggleTooltip();
        } else if (event.key === "Escape") {
            isVisible = false;
        }
    }
</script>

<span class="relative inline">
    <span
        class="border-b border-dotted border-current cursor-help relative group"
        role="button"
        tabindex="0"
        aria-label={definition}
        aria-expanded={isVisible}
        on:mouseenter={showTooltip}
        on:mouseleave={hideTooltip}
        on:click={toggleTooltip}
        on:keydown={handleKeyDown}
        >{term}<span
            class="absolute bottom-full left-1/2 transform -translate-x-1/2 -translate-y-2
                   bg-base-300 text-base-content text-xs px-4 py-3 rounded-md
                   transition-all duration-200 z-50 w-72 text-center shadow-lg
                   pointer-events-none border border-base-200 whitespace-normal
                   {isVisible ? 'opacity-100 visible' : 'opacity-0 invisible'}"
            >{definition}<span
                class="absolute top-full left-1/2 transform -translate-x-1/2
                       border-4 border-transparent border-t-base-300"
            ></span>
        </span>
    </span>
</span>
