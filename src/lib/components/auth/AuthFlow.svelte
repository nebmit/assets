<script lang="ts">
    import { authStore } from "$lib/stores/authStore";
    import SSOLogin from "./SSOLogin.svelte";
    import EncryptionSetup from "./EncryptionSetup.svelte";
    import EncryptionUnlock from "./EncryptionUnlock.svelte";
    import DataRecovery from "./DataRecovery.svelte";
    import type { AuthState } from "$lib/types/user";
    import { fade, fly } from "svelte/transition";

    export let onAuthComplete: () => void;

    let authState: AuthState;
    authStore.subscribe((state) => (authState = state));

    function handleAuthenticated() {
        // User has completed SSO, flow continues automatically based on user state
        console.log("SSO authentication completed");
    }

    function handleEncryptionSetup() {
        // First-time user has completed encryption setup
        console.log("Encryption setup completed");
        onAuthComplete();
    }

    function handleEncryptionUnlock() {
        // Returning user has unlocked their encryption
        console.log("Encryption unlocked");
        onAuthComplete();
    }

    function handleAccountReset() {
        // User has reset their account, back to setup
        console.log("Account reset completed");
    }

    function handleBackToAuth() {
        // User wants to try authentication again
        console.log("Back to authentication");
    }
</script>

{#if authState?.authStep === "sso"}
    <div in:fly={{ y: 20, duration: 600 }} out:fly={{ y: -20, duration: 400 }}>
        <SSOLogin on:authenticated={handleAuthenticated} />
    </div>
{:else if authState?.authStep === "encryption-setup"}
    <div in:fly={{ y: 20, duration: 600 }} out:fly={{ y: -20, duration: 400 }}>
        <EncryptionSetup on:encryptionSetup={handleEncryptionSetup} />
    </div>
{:else if authState?.authStep === "encryption-unlock"}
    <div in:fly={{ y: 20, duration: 600 }} out:fly={{ y: -20, duration: 400 }}>
        <EncryptionUnlock
            user={authState.user}
            on:unlocked={handleEncryptionUnlock}
        />
    </div>
{:else if authState?.authStep === "data-recovery"}
    <div in:fly={{ y: 20, duration: 600 }} out:fly={{ y: -20, duration: 400 }}>
        <DataRecovery
            on:accountReset={handleAccountReset}
            on:backToAuth={handleBackToAuth}
        />
    </div>
{/if}
