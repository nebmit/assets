<script lang="ts">
    export let term: string;
    export let definition: string;
</script>

<span class="relative inline">
    <span
        class="border-b border-dotted border-current cursor-help relative group"
        role="button"
        tabindex="0"
        aria-label={definition}
        >{term}<span
            class="absolute bottom-full left-1/2 transform -translate-x-1/2 -translate-y-2
                   bg-base-300 text-base-content text-xs px-4 py-3 rounded-md
                   opacity-0 invisible group-hover:opacity-100 group-hover:visible
                   transition-all duration-200 z-50 w-72 text-center shadow-lg
                   pointer-events-none border border-base-200 whitespace-normal"
            >{definition}<span
                class="absolute top-full left-1/2 transform -translate-x-1/2
                       border-4 border-transparent border-t-base-300"
            ></span>
        </span>
    </span>
</span>
