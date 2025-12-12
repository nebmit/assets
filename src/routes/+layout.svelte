<script lang="ts">
	import "../app.css";
	import { authStore } from "$lib/stores/authStore";
	import { onMount } from "svelte";

	let { children, data } = $props();

	// If user is authenticated on the server, update the auth store
	onMount(() => {
		if (data && data.user && data.user.isAuthenticated) {
			// User is authenticated via SSO - skip to encryption step
			authStore.handleSSOCallback(data.user);
		}
	});
</script>

{@render children()}
