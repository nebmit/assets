<script lang="ts">
    export let stepNumber: number;
    export let title: string;
</script>

<div class="flex gap-4">
    <div
        class="w-8 h-8 bg-primary text-primary-content rounded-full flex items-center justify-center text-sm font-medium flex-shrink-0 shadow-sm"
    >
        {stepNumber}
    </div>
    <div class="flex-1">
        <h4 class="font-medium text-base-content mb-2">
            {title}
        </h4>
        <div class="text-base-content/70 text-sm leading-relaxed">
            <slot />
        </div>
    </div>
</div>
