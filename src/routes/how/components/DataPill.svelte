<script lang="ts">
    export let title: string;
    export let items: string[];
    export let type: "success" | "primary" = "success";

    $: typeStyles = {
        success: {
            bg: "bg-success/10",
            border: "border-success/20",
            title: "text-success",
        },
        primary: {
            bg: "bg-primary/10",
            border: "border-primary/20",
            title: "text-primary",
        },
    };
</script>

<div
    class="rounded-lg p-4 border transition-colors duration-200 {typeStyles[
        type
    ].bg} {typeStyles[type].border}"
>
    <h4 class="font-medium mb-3 {typeStyles[type].title}">
        {title}
    </h4>
    <ul class="text-sm text-base-content/70 space-y-2">
        {#each items as item}
            <li class="flex items-start gap-2">
                <span class="text-base-content/40 mt-1">•</span>
                <span>{item}</span>
            </li>
        {/each}
    </ul>
</div>
