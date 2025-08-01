<script lang="ts">
    export let isOpen: boolean;
    export let onClick: () => void;

    let buttonElement: HTMLButtonElement;

    export function getButtonElement() {
        return buttonElement;
    }
</script>

<button
    bind:this={buttonElement}
    class="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-1 focus:ring-offset-base-100 {isOpen
        ? 'bg-base-200/50 text-base-content'
        : 'text-base-content/60 hover:text-base-content hover:bg-base-200/50'}"
    on:click={onClick}
    aria-expanded={isOpen}
    aria-haspopup="true"
    aria-label="User account menu"
>
    <svg
        class="w-3.5 h-3.5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
    >
        <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
        />
    </svg>
    <span class="hidden sm:inline">Menu</span>
    <svg
        class="w-3 h-3 transition-transform duration-200"
        class:rotate-180={isOpen}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
    >
        <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M19 9l-7 7-7-7"
        />
    </svg>
</button>
