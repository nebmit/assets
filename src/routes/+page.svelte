<script lang="ts">
    import { Dashboard } from "$lib/components/dashboard";
    import Header from "$lib/components/header";
    import AuthFlow from "$lib/components/auth/AuthFlow.svelte";
    import { authStore } from "$lib/stores/authStore";
    import type { AuthState } from "$lib/types/user";
    import { fade, fly } from "svelte/transition";

    let authState: AuthState;
    authStore.subscribe((state) => (authState = state));

    $: user = authState?.user || { id: "", isLoggedIn: false };
    $: isAuthenticated = authState?.authStep === "authenticated";

    function handleAuthComplete() {
        console.log("Authentication flow completed");
    }
</script>

<svelte:head>
    <title>assets</title>
</svelte:head>

{#if isAuthenticated}
    <!-- Authenticated state - show app -->
    <div
        class="bg-base-100 min-h-screen text-base-content"
        in:fade={{ duration: 700 }}
    >
        <div in:fly={{ y: 10, duration: 600, delay: 100 }}>
            <Header {user} />
            <Dashboard />
        </div>
    </div>
{:else}
    <!-- Authentication flow -->
    <div in:fade={{ duration: 500 }}>
        <AuthFlow onAuthComplete={handleAuthComplete} />
    </div>
{/if}
