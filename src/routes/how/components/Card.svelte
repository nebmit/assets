<script lang="ts">
    export let title: string = "";
    export let showHeader: boolean = true;
</script>

<div
    class="bg-base-200/30 border border-base-300/40 rounded-xl p-8 mb-8 transition-colors duration-200 hover:border-base-300/60"
>
    {#if showHeader && title}
        <h2
            class="text-xl font-medium text-base-content mb-6 flex items-center gap-3"
        >
            {#if $$slots.icon}
                <div
                    class="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center"
                >
                    <slot name="icon" />
                </div>
            {/if}
            {title}
        </h2>
    {/if}

    <slot />
</div>
