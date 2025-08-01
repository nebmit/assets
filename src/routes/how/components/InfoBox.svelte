<script lang="ts">
    export let type: "info" | "warning" = "info";
    export let title: string;

    const iconPaths = {
        info: "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
        warning:
            "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z",
    };

    $: typeStyles = {
        info: {
            bg: "bg-info/10",
            border: "border-info/20",
            icon: "text-info",
            title: "text-info",
        },
        warning: {
            bg: "bg-warning/10",
            border: "border-warning/20",
            icon: "text-warning",
            title: "text-warning",
        },
    };
</script>

<div
    class="rounded-lg p-4 border transition-colors duration-200 {typeStyles[
        type
    ].bg} {typeStyles[type].border}"
>
    <div class="flex items-start gap-3">
        <svg
            class="w-4 h-4 flex-shrink-0 mt-0.5 {typeStyles[type].icon}"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
        >
            <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d={iconPaths[type]}
            />
        </svg>
        <div>
            <div class="text-sm font-medium {typeStyles[type].title}">
                {title}
            </div>
            <div class="text-xs text-base-content/70 mt-1 leading-relaxed">
                <slot />
            </div>
        </div>
    </div>
</div>
