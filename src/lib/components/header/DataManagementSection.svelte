<script lang="ts">
    export let onDataExport: (() => void) | undefined = undefined;
    export let onPasswordMigration: (() => void) | undefined = undefined;
    export let onLogout: (() => void) | undefined = undefined;
</script>

<div class="border-t border-base-300/30 mt-2 pt-2">
    <div class="px-3 py-2 border-b border-base-300/30">
        <div
            class="text-xs text-base-content/60 font-medium tracking-wide uppercase"
        >
            Data Management
        </div>
    </div>

    <button
        class="w-full text-left px-3 py-2.5 text-sm text-base-content/80 hover:text-base-content hover:bg-base-300/30 transition-colors flex items-center gap-2"
        on:click={() => onDataExport?.()}
    >
        <svg
            class="w-4 h-4 text-base-content/60"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
        >
            <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10"
            />
        </svg>
        Export Data
    </button>

    <button
        class="w-full text-left px-3 py-2.5 text-sm text-base-content/80 hover:text-base-content hover:bg-base-300/30 transition-colors flex items-center gap-2"
        on:click={() => onPasswordMigration?.()}
    >
        <svg
            class="w-4 h-4 text-base-content/60"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
        >
            <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
            />
        </svg>
        Migrate Password
    </button>

    <div class="border-t border-base-300/30 mt-2 pt-2">
        <button
            class="w-full text-left px-3 py-2.5 text-sm text-error/80 hover:text-error hover:bg-error/5 transition-colors flex items-center gap-2"
            on:click={() => onLogout?.()}
        >
            <svg
                class="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
            >
                <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                />
            </svg>
            Logout
        </button>

        <div class="px-3 py-2 mt-2 border-t border-base-300/30">
            <a
                href="/how"
                class="text-xs text-base-content/50 hover:text-base-content/70 transition-colors duration-200 flex items-center gap-1.5"
            >
                <svg
                    class="w-3 h-3"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                </svg>
                <span>What happens to my data?</span>
            </a>
        </div>
    </div>
</div>
