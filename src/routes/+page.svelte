<script lang="ts">
    import { Dashboard } from "$lib/components/dashboard";
    import Header from "$lib/components/header";

    // Mock user data - replace with real auth later
    let user = {
        id: "a7b3c9d8-4e2f-1a6b-8c5d-9e0f2a3b4c5d",
        isLoggedIn: true,
    };
</script>

<svelte:head>
    <title>assets</title>
</svelte:head>

<div class="bg-base-100 min-h-screen text-base-content">
    <Header {user} />
    <Dashboard />
</div>
