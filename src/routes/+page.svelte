<script lang="ts">
	/* ---------- helpers ---------- */
	const rand = (n = 32) => crypto.getRandomValues(new Uint8Array(n));
	const toHex = (buf: ArrayBuffer | Uint8Array) => {
		const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
		return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
	};

	const stringToUint8Array = (str: string) => new TextEncoder().encode(str);
	const ensureUint8Array = (buffer: any) => {
		if (buffer instanceof ArrayBuffer) {
			return new Uint8Array(buffer);
		} else if (buffer instanceof Uint8Array) {
			return buffer;
		}
		return buffer;
	};

	const base64urlToUint8Array = (base64url: string) => {
		const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
		const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);

		try {
			const binaryString = atob(padded);
			const bytes = new Uint8Array(binaryString.length);
			for (let i = 0; i < binaryString.length; i++) {
				bytes[i] = binaryString.charCodeAt(i);
			}
			return bytes;
		} catch (error) {
			console.error("Error converting credential ID:", error);
			return new Uint8Array(
				Array.from(
					atob(base64url.replace(/-/g, "+").replace(/_/g, "/")),
					(c) => c.charCodeAt(0),
				),
			);
		}
	};

	const RP_ID = "timben.net";

	/* ---------- reactive state ---------- */
	let status = "Idle…";
	let secretHex = "";
	let credentialId: string | null = null;
	let savedCredentials: Array<{
		id: string;
		prfSupported: boolean;
		authenticatorType: string;
		createdAt: string;
		domain: string;
	}> = [];

	let features: Record<string, string | boolean | null> = {
		"PublicKeyCredential API": false,
		"Platform authenticator (isUVPAA)": null,
		"Conditional UI available": null,
		"PRF extension support": null,
		"Secure context (HTTPS)": null,
		"Current RP ID": null,
		"RP ID matches domain": null,
		"WebAuthn well-known endpoint": null,
	};

	let debugInfo: Record<string, any> = {};
	let logs: Array<{ timestamp: string; level: string; message: string }> = [];
	let showRegisterOptions = false;
	let selectedAuthenticatorType = "platform";

	/* ---------- debug logging ---------- */
	function log(
		level: "info" | "warn" | "error",
		message: string,
		data?: any,
	) {
		const timestamp = new Date().toISOString();
		logs = [{ timestamp, level, message }, ...logs].slice(0, 50); // Keep last 50 logs
		console[level](`[${timestamp}] ${message}`, data || "");
	}

	/* ---------- credential management ---------- */
	function loadSavedCredentials() {
		try {
			const saved = localStorage.getItem("webauthn_credentials");
			if (saved) {
				savedCredentials = JSON.parse(saved);
			}
		} catch (error) {
			console.warn("Error loading saved credentials:", error);
			savedCredentials = [];
		}
	}

	function saveCredential(
		credId: string,
		prfSupported: boolean,
		authenticatorType: string,
	) {
		const credential = {
			id: credId,
			prfSupported: prfSupported,
			authenticatorType: authenticatorType,
			createdAt: new Date().toISOString(),
			domain: window.location.hostname,
		};

		savedCredentials = savedCredentials.filter(
			(cred) => cred.id !== credId,
		);
		savedCredentials.push(credential);

		try {
			localStorage.setItem(
				"webauthn_credentials",
				JSON.stringify(savedCredentials),
			);
		} catch (error) {
			console.warn("Error saving credential:", error);
		}
	}

	/* ---------- feature detection on mount ---------- */
	import { onMount } from "svelte";
	onMount(async () => {
		log("info", "Starting feature detection...");

		// Collect environment info
		debugInfo = {
			userAgent: navigator.userAgent,
			platform: navigator.platform,
			vendor: navigator.vendor,
			language: navigator.language,
			languages: navigator.languages,
			cookieEnabled: navigator.cookieEnabled,
			onLine: navigator.onLine,
			hardwareConcurrency: navigator.hardwareConcurrency,
			maxTouchPoints: navigator.maxTouchPoints,
			webdriver: (navigator as any).webdriver,
			location: {
				protocol: window.location.protocol,
				hostname: window.location.hostname,
				port: window.location.port,
				pathname: window.location.pathname,
			},
			screen: {
				width: screen.width,
				height: screen.height,
				pixelDepth: screen.pixelDepth,
				colorDepth: screen.colorDepth,
			},
		};

		log("info", "Environment info collected", debugInfo);

		features["PublicKeyCredential API"] = !!window.PublicKeyCredential;
		features["Secure context (HTTPS)"] = window.isSecureContext;
		features["Current RP ID"] = RP_ID;

		// Check if RP ID matches current domain
		const currentDomain = window.location.hostname;
		features["RP ID matches domain"] = RP_ID === currentDomain;

		log(
			"info",
			`Domain check: Current=${currentDomain}, RP_ID=${RP_ID}, Match=${features["RP ID matches domain"]}`,
		);

		loadSavedCredentials();

		// Check WebAuthn well-known endpoint
		try {
			log(
				"info",
				`Checking WebAuthn well-known endpoint: https://${RP_ID}/.well-known/webauthn`,
			);
			const wellKnownUrl = `https://${RP_ID}/.well-known/webauthn`;
			const response = await fetch(wellKnownUrl, {
				method: "GET",
				mode: "cors",
				cache: "no-cache",
			});

			log(
				"info",
				`Well-known endpoint response: ${response.status} ${response.statusText}`,
			);

			if (response.ok) {
				const data = await response.json();
				log("info", "Well-known endpoint data", data);

				// Basic validation of well-known format
				if (data && (data.origins || data.origin)) {
					features["WebAuthn well-known endpoint"] = "✓ Valid";

					// Check if current origin is allowed
					const currentOrigin = window.location.origin;
					const allowedOrigins = data.origins || [data.origin];
					const originAllowed =
						allowedOrigins.includes(currentOrigin);
					log(
						"info",
						`Origin check: Current=${currentOrigin}, Allowed=${JSON.stringify(allowedOrigins)}, Match=${originAllowed}`,
					);

					if (!originAllowed) {
						features["WebAuthn well-known endpoint"] =
							"⚠️ Origin not allowed";
					}
				} else {
					features["WebAuthn well-known endpoint"] =
						"⚠️ Invalid format";
					log("warn", "Well-known endpoint has invalid format", data);
				}
			} else if (response.status === 404) {
				features["WebAuthn well-known endpoint"] = "❌ Not found";
				log(
					"info",
					"Well-known endpoint not found (404) - this is optional",
				);
			} else {
				features["WebAuthn well-known endpoint"] =
					`❌ Error ${response.status}`;
				log(
					"warn",
					`Well-known endpoint error: ${response.status} ${response.statusText}`,
				);
			}
		} catch (error) {
			log("error", "Well-known endpoint check failed", error);
			features["WebAuthn well-known endpoint"] = "❌ Network error";
		}

		if (!features["PublicKeyCredential API"]) {
			log(
				"error",
				"PublicKeyCredential API not available - WebAuthn not supported",
			);
			return;
		}

		// Detailed WebAuthn API detection
		log("info", "Checking detailed WebAuthn support...");
		debugInfo.webauthn = {
			hasCreate: typeof navigator.credentials?.create === "function",
			hasGet: typeof navigator.credentials?.get === "function",
			hasPreventSilentAccess:
				typeof navigator.credentials?.preventSilentAccess ===
				"function",
			publicKeyCredentialMethods: Object.getOwnPropertyNames(
				PublicKeyCredential.prototype,
			),
			publicKeyCredentialStaticMethods:
				Object.getOwnPropertyNames(PublicKeyCredential),
		};

		try {
			features["Platform authenticator (isUVPAA)"] =
				await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
			log(
				"info",
				`Platform authenticator available: ${features["Platform authenticator (isUVPAA)"]}`,
			);
		} catch (error) {
			log(
				"error",
				"Error checking platform authenticator availability",
				error,
			);
			features["Platform authenticator (isUVPAA)"] = false;
		}

		if ((PublicKeyCredential as any).isConditionalMediationAvailable) {
			try {
				features["Conditional UI available"] = await (
					PublicKeyCredential as any
				).isConditionalMediationAvailable();
				log(
					"info",
					`Conditional UI available: ${features["Conditional UI available"]}`,
				);
			} catch (error) {
				log(
					"error",
					"Error checking conditional UI availability",
					error,
				);
				features["Conditional UI available"] = false;
			}
		} else {
			features["Conditional UI available"] = "—";
			log("info", "Conditional UI method not available");
		}

		// Note: PRF extension support detection removed as it was unreliable
		// The only reliable way to test PRF support is during actual credential registration/authentication
		features["PRF extension support"] = "Test during registration";

		log("info", "Feature detection complete", { features, debugInfo });
	});

	/* ---------- register new passkey ---------- */
	async function registerPasskey() {
		status = "Registering passkey...";
		log("info", "Starting passkey registration", {
			selectedAuthenticatorType,
		});

		try {
			const challenge = rand(32);
			const userId = rand(64);

			const authenticatorSelection: any = {
				userVerification: "required",
				residentKey: "required",
			};

			if (selectedAuthenticatorType === "platform") {
				authenticatorSelection.authenticatorAttachment = "platform";
			} else if (selectedAuthenticatorType === "cross-platform") {
				authenticatorSelection.authenticatorAttachment =
					"cross-platform";
			}

			const createCredentialOptions = {
				publicKey: {
					challenge: challenge,
					rp: {
						name: "Passkey PRF Debug",
						id: RP_ID,
					},
					user: {
						id: userId,
						name: "user@example.com",
						displayName: "Debug User",
					},
					pubKeyCredParams: [
						{ alg: -7, type: "public-key" as const }, // ES256
						{ alg: -257, type: "public-key" as const }, // RS256
					],
					authenticatorSelection: authenticatorSelection,
					timeout: 60000,
					extensions: {
						prf: {}, // Request PRF extension support
					},
				},
			};

			log(
				"info",
				"Creating credential with options",
				createCredentialOptions,
			);
			const credential = (await navigator.credentials.create(
				createCredentialOptions,
			)) as any;
			credentialId = credential.id;
			const extensionResults = credential.getClientExtensionResults();

			log("info", "Credential created", {
				credentialId,
				extensionResults,
			});

			const prfSupported =
				extensionResults.prf && extensionResults.prf.enabled;
			if (credentialId) {
				saveCredential(
					credentialId,
					prfSupported,
					selectedAuthenticatorType,
				);
				loadSavedCredentials();

				// Test PRF functionality if reported as supported
				if (prfSupported) {
					status = "Testing PRF functionality...";
					log(
						"info",
						"PRF reported as supported, testing functionality...",
					);
					await new Promise((resolve) => setTimeout(resolve, 500));

					try {
						const testResult =
							await testPRFWithCredential(credentialId);
						if (testResult) {
							status =
								"✅ Passkey registered with working PRF support!";
							log("info", "PRF test successful");
						} else {
							status =
								"⚠️ Passkey registered but PRF test inconclusive";
							log("warn", "PRF test inconclusive");
						}
					} catch (testError) {
						log("error", "PRF test failed", testError);
						status = "⚠️ Passkey registered but PRF test failed";
					}
				} else {
					status =
						"⚠️ Passkey registered but does not support PRF extension";
					log("warn", "PRF not supported by this authenticator");
				}
			}

			showRegisterOptions = false;
		} catch (error: any) {
			log("error", "Registration error", error);
			status = `❌ Registration failed: ${error.message}`;
		}
	}

	/* ---------- test PRF with credential ---------- */
	async function testPRFWithCredential(credId: string): Promise<boolean> {
		const testChallenge = rand(32);
		const testSalt = stringToUint8Array("test-prf-support");

		log("info", "Starting PRF test", { credId, testSalt: toHex(testSalt) });

		const testOptions = {
			publicKey: {
				challenge: testChallenge,
				allowCredentials: [
					{
						type: "public-key" as const,
						id: base64urlToUint8Array(credId),
					},
				],
				userVerification: "required" as const,
				timeout: 30000,
				extensions: {
					prf: {
						eval: {
							first: testSalt,
						},
					},
				},
			},
		};

		log("info", "PRF test options", testOptions);

		const testCred = (await navigator.credentials.get(testOptions)) as any;
		const testExtensionResults = testCred.getClientExtensionResults();

		log("info", "PRF test extension results", testExtensionResults);

		const prfResult = testExtensionResults.prf?.results?.first;
		const convertedResult = prfResult ? ensureUint8Array(prfResult) : null;

		log("info", "PRF test result analysis", {
			hasPrf: !!testExtensionResults.prf,
			hasResults: !!testExtensionResults.prf?.results,
			hasFirst: !!testExtensionResults.prf?.results?.first,
			resultLength: convertedResult?.length,
			resultHex: convertedResult ? toHex(convertedResult) : null,
		});

		return !!(
			testExtensionResults.prf &&
			testExtensionResults.prf.results &&
			testExtensionResults.prf.results.first &&
			convertedResult &&
			convertedResult.length > 0
		);
	}

	/* ---------- use existing passkey ---------- */
	async function useExistingPasskey() {
		status = "Authenticating with existing passkey...";
		log("info", "Starting authentication with existing passkey");

		try {
			const challenge = rand(32);
			const testSalt = stringToUint8Array("test-prf-support");

			// Find the most recent credential to determine authenticator preference
			const mostRecentCred = savedCredentials.sort(
				(a, b) =>
					new Date(b.createdAt).getTime() -
					new Date(a.createdAt).getTime(),
			)[0];

			const getCredentialOptions: any = {
				publicKey: {
					challenge: challenge,
					userVerification: "required" as const,
					timeout: 60000,
					extensions: {
						prf: {
							eval: {
								first: testSalt,
							},
						},
					},
				},
			};

			// If we have a recent credential with a known authenticator type, prefer that
			if (
				mostRecentCred?.authenticatorType &&
				mostRecentCred.authenticatorType !== "any"
			) {
				getCredentialOptions.publicKey.authenticatorSelection = {
					authenticatorAttachment:
						mostRecentCred.authenticatorType === "platform"
							? "platform"
							: "cross-platform",
					userVerification: "required",
				};
				log(
					"info",
					`Preferring ${mostRecentCred.authenticatorType} authenticator based on most recent credential`,
				);
			}

			// If we have saved credentials, specify them to avoid prompting for hardware keys unnecessarily
			if (savedCredentials.length > 0) {
				getCredentialOptions.publicKey.allowCredentials =
					savedCredentials.map((cred) => ({
						type: "public-key" as const,
						id: base64urlToUint8Array(cred.id),
					}));
				log(
					"info",
					`Allowing ${savedCredentials.length} specific saved credentials`,
				);
			}

			log("info", "Authentication options", getCredentialOptions);

			const cred = (await navigator.credentials.get(
				getCredentialOptions,
			)) as any;
			credentialId = cred.id;

			log("info", "Authentication successful", { credentialId });

			const extensionResults = cred.getClientExtensionResults();
			log("info", "Authentication extension results", extensionResults);

			const prfResult = extensionResults.prf?.results?.first;
			const convertedResult = prfResult
				? ensureUint8Array(prfResult)
				: null;
			const prfSupported = !!(
				extensionResults.prf &&
				extensionResults.prf.results &&
				extensionResults.prf.results.first &&
				convertedResult &&
				convertedResult.length > 0
			);

			log("info", "PRF support analysis", {
				hasPrf: !!extensionResults.prf,
				hasResults: !!extensionResults.prf?.results,
				hasFirst: !!extensionResults.prf?.results?.first,
				resultLength: convertedResult?.length,
				prfSupported,
			});

			// Update saved credential if we have clear evidence
			const existingCred = savedCredentials.find(
				(c) => c.id === credentialId,
			);
			if (existingCred && extensionResults.prf?.results?.first) {
				existingCred.prfSupported = prfSupported;
				log("info", "Updated saved credential PRF status", {
					credentialId,
					prfSupported,
				});
				try {
					localStorage.setItem(
						"webauthn_credentials",
						JSON.stringify(savedCredentials),
					);
				} catch (error) {
					log("error", "Error updating credential", error);
				}
			}

			if (prfSupported) {
				status =
					"✅ Successfully authenticated with PRF-capable passkey!";
			} else {
				status =
					"⚠️ Authenticated but this passkey does not support PRF";
			}
		} catch (error: any) {
			log("error", "Authentication error", error);
			status = `❌ Authentication failed: ${error.message}`;
		}
	}

	/* ---------- grab PRF secret ---------- */
	async function fetchSecret() {
		if (!credentialId) {
			status = "❌ Please register or authenticate with a passkey first";
			return;
		}

		status = "Deriving PRF secret...";
		secretHex = "";
		log("info", "Starting PRF secret derivation", { credentialId });

		if (!window.isSecureContext) {
			status = "❌ Insecure context - HTTPS required";
			log("error", "Insecure context detected");
			return;
		}

		try {
			// Use the hardcoded salt 'passkeysecret' like in the demo
			const salt = stringToUint8Array("passkeysecret");
			const challenge = rand(32);

			log("info", "PRF secret request details", {
				salt: toHex(salt),
				saltString: "passkeysecret",
				challenge: toHex(challenge),
				credentialId,
			});

			const publicKey: PublicKeyCredentialRequestOptions = {
				challenge: challenge,
				allowCredentials: [
					{
						type: "public-key",
						id: base64urlToUint8Array(credentialId),
					},
				],
				userVerification: "required",
				timeout: 60_000,
				extensions: {
					prf: {
						eval: {
							first: salt,
						},
					},
				},
			} as any;

			log("info", "Making PRF request with options", publicKey);

			const assertion = (await navigator.credentials.get({
				publicKey,
			})) as any;

			log("info", "PRF assertion received", {
				assertionId: assertion.id,
			});

			const extensionResults = assertion.getClientExtensionResults();
			log("info", "PRF extension results", extensionResults);

			const prf = extensionResults.prf;

			if (!prf?.results?.first) {
				log("error", "PRF extension failed", { prf });
				status = "❌ PRF extension not supported or failed";
				return;
			}

			const prfResult = ensureUint8Array(prf.results.first);
			secretHex = toHex(prfResult);

			log("info", "PRF secret derived successfully", {
				resultLength: prfResult.length,
				resultHex: secretHex,
			});

			status = "✅ PRF secret retrieved successfully!";
		} catch (err: any) {
			log("error", "WebAuthn error", err);
			if (err.name === "SecurityError") {
				status = `❌ Security Error: ${err.message}. Check: 1) HTTPS required, 2) RP ID must match domain (using: ${RP_ID})`;
			} else if (err.name === "NotAllowedError") {
				status = "❌ User cancelled or no passkey available";
			} else {
				status = `❌ ${err.name}: ${err.message}`;
			}
		}
	}

	/* ---------- clear saved credentials ---------- */
	function clearSavedCredentials() {
		if (
			confirm(
				"Clear all saved passkey information? This will not delete actual passkeys.",
			)
		) {
			localStorage.removeItem("webauthn_credentials");
			savedCredentials = [];
			credentialId = null;
			status = "Saved credentials cleared";
		}
	}
</script>

<main class="p-6 max-w-2xl mx-auto flex flex-col gap-6">
	<h1 class="text-2xl font-bold">Passkey PRF Debug</h1>

	<!-- Feature Detection -->
	<section class="bg-gray-50 p-4 rounded-lg">
		<h2 class="text-lg font-semibold mb-3">Feature Detection</h2>
		<ul class="text-sm space-y-1">
			{#each Object.entries(features) as [k, v]}
				<li class="flex justify-between">
					<span>{k}:</span>
					<span
						class={v === true
							? "text-green-600"
							: v === false
								? "text-red-600"
								: "text-gray-600"}
					>
						{v === null
							? "…"
							: v === true
								? "✔"
								: v === false
									? "✖"
									: v}
					</span>
				</li>
			{/each}
		</ul>

		<!-- Quick Environment Info -->
		{#if Object.keys(debugInfo).length > 0}
			<div class="mt-4 pt-3 border-t text-xs">
				<div class="grid grid-cols-2 gap-2 text-gray-600">
					<div>
						<strong>Browser:</strong>
						{debugInfo.userAgent?.split(" ").slice(-2).join(" ") ||
							"Unknown"}
					</div>
					<div>
						<strong>Platform:</strong>
						{debugInfo.platform || "Unknown"}
					</div>
					<div>
						<strong>Protocol:</strong>
						{debugInfo.location?.protocol || "Unknown"}
					</div>
					<div>
						<strong>Domain:</strong>
						{debugInfo.location?.hostname || "Unknown"}
					</div>
					{#if debugInfo.webauthn}
						<div>
							<strong>WebAuthn Methods:</strong>
							{debugInfo.webauthn.publicKeyCredentialMethods
								?.length || 0}
						</div>
						<div>
							<strong>Has Create:</strong>
							{debugInfo.webauthn.hasCreate ? "✔" : "✖"}
						</div>
					{/if}
				</div>
			</div>
		{/if}
	</section>

	<!-- Passkey Management -->
	<section class="bg-gray-50 p-4 rounded-lg">
		<h2 class="text-lg font-semibold mb-3">Step 1: Passkey Setup</h2>

		{#if savedCredentials.length > 0}
			<div class="bg-green-100 border border-green-400 p-3 rounded mb-4">
				<p class="font-medium">
					Found {savedCredentials.length} existing passkey(s):
				</p>
				<ul class="text-sm mt-2 space-y-1">
					{#each savedCredentials as cred}
						<li>
							• {cred.authenticatorType || "Unknown"}
							({cred.prfSupported
								? "PRF supported"
								: "No PRF support"}) - Created: {new Date(
								cred.createdAt,
							).toLocaleDateString()}
						</li>
					{/each}
				</ul>
				{#if savedCredentials.some((cred) => cred.prfSupported)}
					<p class="text-green-700 font-medium mt-2">
						{savedCredentials.filter((cred) => cred.prfSupported)
							.length} passkey(s) support PRF extension!
					</p>
				{:else}
					<p class="text-orange-600 mt-2">
						⚠️ None of your existing passkeys support PRF extension.
					</p>
				{/if}
			</div>
		{:else}
			<div class="text-gray-600 mb-4">
				No existing passkeys found. You'll need to register a new one.
			</div>
		{/if}

		<div class="space-x-2 mb-4">
			{#if savedCredentials.length > 0}
				<button
					class="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:bg-gray-400"
					on:click={useExistingPasskey}
					disabled={!features["PublicKeyCredential API"]}
				>
					Use Existing Passkey
				</button>
			{/if}

			<button
				class="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:bg-gray-400"
				on:click={() => (showRegisterOptions = true)}
				disabled={!features["PublicKeyCredential API"]}
			>
				Register New Passkey
			</button>

			<button
				class="bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700"
				on:click={clearSavedCredentials}
			>
				Clear Saved
			</button>
		</div>

		{#if showRegisterOptions}
			<div class="mt-4 p-4 border rounded-lg bg-white">
				<h3 class="font-medium mb-3">Choose authenticator type:</h3>
				<div class="space-y-3">
					<label class="flex items-start space-x-2">
						<input
							type="radio"
							bind:group={selectedAuthenticatorType}
							value="platform"
							class="mt-1"
						/>
						<div>
							<div class="font-medium">
								Platform Authenticator
							</div>
							<div class="text-sm text-gray-600">
								Touch ID, Face ID, Windows Hello
							</div>
							<div class="text-xs text-orange-600">
								⚠️ macOS users: Requires macOS Sequoia 15.4.1+
								with iCloud Keychain enabled
							</div>
						</div>
					</label>

					<label class="flex items-start space-x-2">
						<input
							type="radio"
							bind:group={selectedAuthenticatorType}
							value="cross-platform"
							class="mt-1"
						/>
						<div>
							<div class="font-medium">
								Cross-Platform Authenticator
							</div>
							<div class="text-sm text-gray-600">
								USB Security Keys (YubiKey, Titan, etc.)
							</div>
						</div>
					</label>

					<label class="flex items-start space-x-2">
						<input
							type="radio"
							bind:group={selectedAuthenticatorType}
							value="any"
							class="mt-1"
						/>
						<div>
							<div class="font-medium">
								Let me choose during registration
							</div>
							<div class="text-sm text-gray-600">
								Browser will show all available options
							</div>
						</div>
					</label>
				</div>

				<div class="mt-4 space-x-2">
					<button
						class="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
						on:click={registerPasskey}
					>
						Register Passkey
					</button>
					<button
						class="bg-gray-500 text-white px-4 py-2 rounded hover:bg-gray-600"
						on:click={() => (showRegisterOptions = false)}
					>
						Cancel
					</button>
				</div>
			</div>
		{/if}
	</section>

	<!-- PRF Secret Generation -->
	<section class="bg-gray-50 p-4 rounded-lg">
		<h2 class="text-lg font-semibold mb-3">Step 2: Generate PRF Secret</h2>
		<p class="text-sm text-gray-600 mb-4">
			Generate a deterministic secret using the salt 'passkeysecret' with
			your authenticated passkey.
		</p>

		<button
			class="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700 disabled:bg-gray-400"
			on:click={fetchSecret}
			disabled={!features["PublicKeyCredential API"] || !credentialId}
		>
			Get PRF Secret
		</button>
	</section>

	<!-- Status and Results -->
	<section class="bg-gray-50 p-4 rounded-lg">
		<h2 class="text-lg font-semibold mb-3">Status & Results</h2>
		<p
			class="text-sm mb-4 p-3 bg-white rounded border"
			class:text-green-700={status.includes("✅")}
			class:text-red-700={status.includes("❌")}
			class:text-orange-700={status.includes("⚠️")}
		>
			{status}
		</p>

		{#if credentialId}
			<div class="bg-blue-50 p-3 rounded mb-4">
				<h3 class="font-medium text-sm mb-2">
					Current Credential Info:
				</h3>
				<div class="text-xs font-mono space-y-1">
					<div>
						<strong>ID:</strong>
						{credentialId.substring(
							0,
							32,
						)}...{credentialId.substring(credentialId.length - 8)}
					</div>
					<div>
						<strong>Full Length:</strong>
						{credentialId.length} chars
					</div>
					{#if savedCredentials.find((c) => c.id === credentialId)}
						{@const cred = savedCredentials.find(
							(c) => c.id === credentialId,
						)}
						<div>
							<strong>Type:</strong>
							{cred?.authenticatorType || "Unknown"}
						</div>
						<div>
							<strong>PRF Support:</strong>
							{cred?.prfSupported ? "✅ Yes" : "❌ No"}
						</div>
						<div>
							<strong>Created:</strong>
							{new Date(cred?.createdAt || "").toLocaleString()}
						</div>
					{/if}
				</div>
			</div>
		{/if}

		{#if secretHex}
			<div class="bg-white p-4 rounded border">
				<h3 class="font-medium mb-2">Generated PRF Secret:</h3>
				<div
					class="break-all text-xs font-mono bg-gray-100 p-2 rounded"
				>
					<strong>Salt used:</strong> 'passkeysecret'<br />
					<strong>Secret (hex):</strong>
					{secretHex}<br />
					<strong>Length:</strong>
					{secretHex.length / 2} bytes
				</div>
				<p class="text-xs text-gray-600 mt-2">
					This secret will be the same every time you use the same
					passkey with the same salt.
				</p>
			</div>
		{/if}
	</section>

	<!-- Browser Compatibility Info -->
	<section class="bg-blue-50 p-4 rounded-lg">
		<h2 class="text-lg font-semibold mb-3">
			Browser/Platform Compatibility
		</h2>
		<div class="text-sm space-y-2">
			<div><strong>✅ Fully Supported:</strong></div>
			<ul class="list-disc list-inside ml-4 space-y-1 text-gray-700">
				<li>Chrome/Edge 128+ (desktop & Android)</li>
				<li>
					Safari 18.0+ on macOS Sequoia 15.4+ with iCloud Keychain
				</li>
				<li>iOS 18/iPadOS 18 with Safari</li>
				<li>YubiKey 5 series and compatible security keys</li>
			</ul>

			<div class="mt-3"><strong>🟡 Partial Support:</strong></div>
			<ul class="list-disc list-inside ml-4 space-y-1 text-gray-700">
				<li>Firefox 114+ (hardware keys only)</li>
				<li>1Password (iOS app, desktop depends on OS)</li>
			</ul>

			<div class="mt-3"><strong>❌ Not Yet Supported:</strong></div>
			<ul class="list-disc list-inside ml-4 space-y-1 text-gray-700">
				<li>Windows Hello (Microsoft hasn't enabled PRF yet)</li>
				<li>Most password managers (Dashlane, Proton Pass, etc.)</li>
			</ul>
		</div>
	</section>

	<!-- Debug Information -->
	<section class="bg-yellow-50 p-4 rounded-lg">
		<h2 class="text-lg font-semibold mb-3">Debug Information</h2>

		<!-- Real-time Logs (most recent) -->
		{#if logs.length > 0}
			<div class="mb-4">
				<h3 class="font-medium text-sm mb-2">
					Recent Activity (Last 5):
				</h3>
				<div class="bg-white p-3 rounded border space-y-1">
					{#each logs.slice(0, 5) as logEntry}
						<div
							class="text-xs font-mono flex gap-2"
							class:text-red-600={logEntry.level === "error"}
							class:text-orange-600={logEntry.level === "warn"}
							class:text-blue-600={logEntry.level === "info"}
						>
							<span class="text-gray-500 w-16"
								>{logEntry.timestamp
									.split("T")[1]
									.split(".")[0]}</span
							>
							<span class="uppercase font-bold w-12 text-xs"
								>{logEntry.level}</span
							>
							<span class="flex-1">{logEntry.message}</span>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Quick Device Info -->
		{#if Object.keys(debugInfo).length > 0}
			<div class="mb-4">
				<h3 class="font-medium text-sm mb-2">Device & Browser:</h3>
				<div class="bg-white p-3 rounded border text-xs">
					<div class="grid grid-cols-1 md:grid-cols-2 gap-2">
						<div>
							<strong>User Agent:</strong>
							{debugInfo.userAgent?.split("(")[0].trim() ||
								"Unknown"}
						</div>
						<div>
							<strong>Platform:</strong>
							{debugInfo.platform || "Unknown"}
						</div>
						<div>
							<strong>Language:</strong>
							{debugInfo.language || "Unknown"}
						</div>
						<div>
							<strong>Touch Points:</strong>
							{debugInfo.maxTouchPoints || 0}
						</div>
						<div>
							<strong>CPU Cores:</strong>
							{debugInfo.hardwareConcurrency || "Unknown"}
						</div>
						<div>
							<strong>Screen:</strong>
							{debugInfo.screen?.width || 0}×{debugInfo.screen
								?.height || 0}
						</div>
						<div>
							<strong>Color Depth:</strong>
							{debugInfo.screen?.colorDepth || 0}-bit
						</div>
						<div>
							<strong>Online:</strong>
							{debugInfo.onLine ? "✅" : "❌"}
						</div>
					</div>
				</div>
			</div>
		{/if}

		<!-- WebAuthn API Details -->
		{#if debugInfo.webauthn}
			<div class="mb-4">
				<h3 class="font-medium text-sm mb-2">WebAuthn API Details:</h3>
				<div class="bg-white p-3 rounded border text-xs">
					<div class="grid grid-cols-2 gap-2">
						<div>
							<strong>Has Create:</strong>
							{debugInfo.webauthn.hasCreate ? "✅" : "❌"}
						</div>
						<div>
							<strong>Has Get:</strong>
							{debugInfo.webauthn.hasGet ? "✅" : "❌"}
						</div>
						<div>
							<strong>Methods Count:</strong>
							{debugInfo.webauthn.publicKeyCredentialMethods
								?.length || 0}
						</div>
						<div>
							<strong>Static Methods:</strong>
							{debugInfo.webauthn.publicKeyCredentialStaticMethods
								?.length || 0}
						</div>
					</div>
					{#if debugInfo.webauthn.publicKeyCredentialMethods?.length > 0}
						<div class="mt-2 pt-2 border-t">
							<strong>Available Methods:</strong>
							<div class="text-gray-600 mt-1">
								{debugInfo.webauthn.publicKeyCredentialMethods
									.filter((m: string) => !m.startsWith("_"))
									.join(", ")}
							</div>
						</div>
					{/if}
				</div>
			</div>
		{/if}

		<!-- Saved Credentials Summary -->
		{#if savedCredentials.length > 0}
			<div class="mb-4">
				<h3 class="font-medium text-sm mb-2">
					Saved Credentials Summary:
				</h3>
				<div class="bg-white p-3 rounded border text-xs space-y-2">
					{#each savedCredentials as cred, i}
						<div
							class="flex justify-between items-center p-2 bg-gray-50 rounded"
						>
							<div>
								<div>
									<strong>#{i + 1}:</strong>
									{cred.authenticatorType || "Unknown"}
								</div>
								<div class="text-gray-600">
									Created: {new Date(
										cred.createdAt,
									).toLocaleDateString()}
								</div>
							</div>
							<div class="text-right">
								<div
									class={cred.prfSupported
										? "text-green-600"
										: "text-red-600"}
								>
									{cred.prfSupported ? "✅ PRF" : "❌ No PRF"}
								</div>
								<div class="text-gray-600">
									{cred.id.substring(0, 8)}...
								</div>
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Collapsible Full Details -->
		{#if Object.keys(debugInfo).length > 0}
			<details class="mb-4">
				<summary class="cursor-pointer font-medium text-sm mb-2"
					>Full Environment Details</summary
				>
				<div
					class="bg-white p-3 rounded border text-xs font-mono overflow-auto max-h-60"
				>
					<pre>{JSON.stringify(debugInfo, null, 2)}</pre>
				</div>
			</details>
		{/if}

		{#if logs.length > 5}
			<details class="mb-4">
				<summary class="cursor-pointer font-medium text-sm mb-2"
					>All Activity Logs ({logs.length})</summary
				>
				<div class="bg-white p-3 rounded border max-h-60 overflow-auto">
					{#each logs as logEntry}
						<div
							class="text-xs font-mono mb-1 flex gap-2"
							class:text-red-600={logEntry.level === "error"}
							class:text-orange-600={logEntry.level === "warn"}
							class:text-blue-600={logEntry.level === "info"}
						>
							<span class="text-gray-500"
								>{logEntry.timestamp
									.split("T")[1]
									.split(".")[0]}</span
							>
							<span class="uppercase font-bold w-12"
								>{logEntry.level}</span
							>
							<span>{logEntry.message}</span>
						</div>
					{/each}
				</div>
			</details>
		{/if}

		<button
			class="mt-2 bg-yellow-600 text-white px-3 py-1 rounded text-sm hover:bg-yellow-700"
			on:click={() => {
				const debugData = {
					timestamp: new Date().toISOString(),
					features,
					debugInfo,
					logs,
					savedCredentials,
					status,
					secretHex,
					credentialId,
					location: window.location.href,
					userAgent: navigator.userAgent,
				};
				navigator.clipboard.writeText(
					JSON.stringify(debugData, null, 2),
				);
				log("info", "Debug data copied to clipboard");
			}}
		>
			Copy Debug Data to Clipboard
		</button>
	</section>
</main>
