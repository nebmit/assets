<script lang="ts">
    export let userId: string;

    function truncateGuid(guid: string): string {
        return guid.slice(0, 8) + "..." + guid.slice(-8);
    }
</script>

<div class="text-right">
    <div class="text-xs text-base-content/50 mb-0.5">Logged in as</div>
    <div
        class="text-sm font-mono text-base-content/80 cursor-default group relative"
    >
        {truncateGuid(userId)}
        <!-- Tooltip -->
        <div
            class="absolute right-0 top-full mt-2 px-3 py-2 bg-base-300 text-base-content text-xs font-mono rounded-md shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-10"
        >
            {userId}
            <div
                class="absolute bottom-full right-4 w-0 h-0 border-l-4 border-r-4 border-b-4 border-l-transparent border-r-transparent border-b-base-300"
            ></div>
        </div>
    </div>
</div>
