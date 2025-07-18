<script lang="ts">
	/* ---------- helpers ---------- */
	const rand = (n = 32) => crypto.getRandomValues(new Uint8Array(n));
	const toHex = (buf: ArrayBuffer) =>
		[...new Uint8Array(buf)]
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("");

	const RP_ID = "timben.net";

	/* ---------- reactive state ---------- */
	let status = "Idle…";
	let secretHex = "";
	let features: Record<string, string | boolean | null> = {
		"PublicKeyCredential API": false,
		"Platform authenticator (isUVPAA)": null,
		"Conditional UI available": null,
		"PRF extension support": null,
		"Secure context (HTTPS)": null,
		"Current RP ID": null,
	};

	/* ---------- feature detection on mount ---------- */
	import { onMount } from "svelte";
	onMount(async () => {
		features["PublicKeyCredential API"] = !!window.PublicKeyCredential;
		features["Secure context (HTTPS)"] = window.isSecureContext;
		features["Current RP ID"] = RP_ID;

		if (!features["PublicKeyCredential API"]) return;

		try {
			features["Platform authenticator (isUVPAA)"] =
				await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
		} catch {
			features["Platform authenticator (isUVPAA)"] = false;
		}

		if ((PublicKeyCredential as any).isConditionalMediationAvailable) {
			try {
				features["Conditional UI available"] = await (
					PublicKeyCredential as any
				).isConditionalMediationAvailable();
			} catch {
				features["Conditional UI available"] = false;
			}
		} else {
			features["Conditional UI available"] = "—";
		}

		// Check PRF extension support
		try {
			features["PRF extension support"] = await checkPRFSupport();
		} catch {
			features["PRF extension support"] = false;
		}
	});

	/* ---------- check PRF support without credentials ---------- */
	async function checkPRFSupport(): Promise<boolean> {
		// Method 1: Check if extensions are supported in general
		if (
			!(window as any).PublicKeyCredential?.prototype
				?.getClientExtensionResults
		) {
			return false;
		}

		// Method 2: Try to create a credential request with PRF extension (but don't execute it)
		try {
			const publicKey: PublicKeyCredentialRequestOptions = {
				rpId: RP_ID,
				challenge: rand(32),
				userVerification: "preferred",
				timeout: 1, // Very short timeout
				extensions: {
					prf: { eval: { first: rand(32) } },
				},
			} as any;

			// We don't actually call this, just check if the browser accepts the extension format
			const supported = "prf" in (publicKey.extensions || {});
			return supported;
		} catch {
			return false;
		}
	}

	/* ---------- grab PRF secret from an existing passkey ---------- */
	export async function fetchSecret() {
		status = "Requesting passkey…";
		secretHex = "";

		// Security context checks
		if (!window.isSecureContext) {
			status = "❌ Insecure context - HTTPS required";
			return;
		}

		try {
			const publicKey: PublicKeyCredentialRequestOptions = {
				rpId: RP_ID,
				challenge: rand(32),
				userVerification: "preferred",
				timeout: 60_000,
				extensions: {
					prf: { eval: { first: rand(32) } },
				},
			} as any;

			console.log("Using RP ID:", RP_ID);
			console.log("Current hostname:", window.location.hostname);
			console.log("Secure context:", window.isSecureContext);

			const assertion = (await navigator.credentials.get({
				publicKey,
			})) as any;

			const prf = assertion.getClientExtensionResults().prf;
			if (!prf?.outputs?.first) {
				status = "PRF extension NOT supported on this passkey/browser.";
				return;
			}

			secretHex = toHex(prf.outputs.first);
			status = "PRF secret retrieved ✔";
		} catch (err) {
			console.error("WebAuthn error:", err);
			if (err instanceof Error) {
				if (err.name === "SecurityError") {
					status = `❌ Security Error: ${err.message}. Check: 1) HTTPS required, 2) RP ID must match domain (using: ${RP_ID})`;
				} else if (err.name === "NotAllowedError") {
					status = "❌ User cancelled or no passkey available";
				} else {
					status = `❌ ${err.name}: ${err.message}`;
				}
			} else {
				status = `❌ ${err}`;
			}
		}
	}
</script>

<main class="p-6 max-w-lg mx-auto flex flex-col gap-4">
	<h1 class="text-xl font-bold">Passkey PRF Debug</h1>

	<h2 class="text-lg font-semibold">Feature detection</h2>
	<ul class="text-sm list-disc list-inside">
		{#each Object.entries(features) as [k, v]}
			<li>
				{k}: {v === null
					? "…"
					: v === true
						? "✔"
						: v === false
							? "✖"
							: v}
			</li>
		{/each}
	</ul>

	<button
		class="btn"
		on:click={fetchSecret}
		disabled={!features["PublicKeyCredential API"]}
	>
		Get PRF secret
	</button>

	<p class="text-sm">{status}</p>

	{#if secretHex}
		<p class="break-all text-xs">
			<strong>Secret (hex):</strong>
			{secretHex}
		</p>
	{/if}
</main>
