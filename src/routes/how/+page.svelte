<script lang="ts">
    import Header from "$lib/components/header/Header.svelte";
    import Card from "./components/Card.svelte";
    import DataPill from "./components/DataPill.svelte";
    import EncryptedDataItem from "./components/EncryptedDataItem.svelte";
    import InfoBox from "./components/InfoBox.svelte";
    import ProcessStep from "./components/ProcessStep.svelte";
    import SecuritySection from "./components/SecuritySection.svelte";
    import Tooltip from "./components/Tooltip.svelte";

    // Mock user data - replace with real auth later
    let user = {
        id: "a7b3c9d8-4e2f-1a6b-8c5d-9e0f2a3b4c5d",
        isLoggedIn: true,
    };

    // Mock encrypted data for demo
    let mockEncryptedData = {
        portfolio:
            "eyJhbGciOiJBMjU2R0NNIiwiZW5jIjoiQTI1NkdDTSJ9.encrypted_portfolio_data_here...",
        holdings:
            "eyJhbGciOiJBMjU2R0NNIiwiZW5jIjoiQTI1NkdDTSJ9.encrypted_holdings_data_here...",
        transactions:
            "eyJhbGciOiJBMjU2R0NNIiwiZW5jIjoiQTI1NkdDTSJ9.encrypted_transactions_data_here...",
    };
</script>

<svelte:head>
    <title>How it works - assets</title>
</svelte:head>

<div class="bg-base-100 min-h-screen text-base-content">
    <Header {user} />

    <div class="p-8 max-w-4xl mx-auto">
        <div class="space-y-8">
            <!-- Header -->
            <div class="text-center mb-12">
                <h1 class="text-3xl font-light text-base-content mb-4">
                    How This Works
                </h1>
                <p class="text-base-content/70 text-lg max-w-2xl mx-auto">
                    A breakdown of the authentication and encryption approach we
                    use.
                </p>
            </div>

            <!-- Authentication -->
            <SecuritySection
                title="Authentication with Passkeys"
                iconName="key"
            >
                <p>
                    You sign in using passkeys (<Tooltip
                        term="WebAuthn"
                        definition="Web Authentication: A secure way to log in without passwords"
                    />). No email, no username, no password to remember. Your
                    device generates a unique key pair and we never see the
                    private key.
                </p>
                <p>
                    This creates a pseudo-anonymous account - you get a random <Tooltip
                        term="GUID"
                        definition="Globally Unique Identifier: A random ID number that identifies your account"
                    /> as your identifier. We can authenticate you but don't know
                    who you actually are.
                </p>
                <InfoBox type="info" title="What are passkeys?">
                    Think of them as a more secure replacement for passwords.
                    They use <Tooltip
                        term="public-key cryptography"
                        definition="Public-key cryptography: Your device keeps a secret key and shares a public key that work together"
                    /> and can't be phished or reused across sites. They're built
                    into most modern devices now.
                </InfoBox>
            </SecuritySection>

            <!-- Encryption -->
            <SecuritySection
                title="Getting Your Encryption Key"
                iconName="lock"
            >
                <p>
                    After you authenticate, we try to use a <Tooltip
                        term="WebAuthn"
                        definition="Web Authentication: A secure way to log in without passwords"
                    />
                    extension called PRF to derive an encryption key directly from
                    your passkey. Same passkey = same key every time.
                </p>
                <InfoBox type="info" title="PRF Extension">
                    PRF (Pseudo-Random Function) is a new WebAuthn extension
                    that lets authenticators generate deterministic keys. It's
                    pretty new - not all devices support it yet.
                </InfoBox>
                <p>
                    If your device doesn't support PRF, you'll just set a
                    password and we'll derive your encryption key from that
                    using <Tooltip
                        term="PBKDF2"
                        definition="Password-Based Key Derivation Function 2: A way to turn your password into an encryption key"
                    />. Either way works fine.
                </p>
                <InfoBox
                    type="warning"
                    title="Important: Use a Password Manager"
                >
                    If you use password-based encryption, store your password in
                    a password manager. We never store your password or
                    encryption key, so if you forget it, your data would be
                    permanently lost.
                </InfoBox>

                <!-- Password Migration -->
                <InfoBox type="info" title="Password Migration">
                    Need to change your encryption password? Use "Migrate
                    Password" in the account menu. It'll re-encrypt everything
                    with your new password while keeping your data intact.
                </InfoBox>
            </SecuritySection>

            <!-- Local-First -->
            <SecuritySection
                title="Everything Happens Locally First"
                iconName="server"
            >
                <p>
                    All the portfolio calculations, price fetching, and data
                    processing happens in your browser. We don't need to see
                    your portfolio data to provide the functionality.
                </p>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
                    <DataPill
                        type="success"
                        title="Stays on your device:"
                        items={[
                            "Price data and calculations",
                            "Portfolio analysis",
                            "Your encryption keys",
                            "Anything readable",
                        ]}
                    />
                    <DataPill
                        type="primary"
                        title="Gets synced to servers:"
                        items={[
                            "Encrypted portfolio data",
                            "Encrypted holdings",
                            "Encrypted transaction history",
                        ]}
                    />
                </div>
            </SecuritySection>

            <!-- The Process -->
            <SecuritySection title="The Process" iconName="process">
                <div class="space-y-6">
                    <ProcessStep
                        stepNumber={1}
                        title="Sign in → Get encryption key"
                    >
                        Use your passkey to authenticate. If it supports PRF, we
                        derive your encryption key from it. If not, you set a
                        password for key derivation.
                    </ProcessStep>

                    <ProcessStep
                        stepNumber={2}
                        title="Everything runs in your browser"
                    >
                        Fetch prices, run calculations, manage your portfolio -
                        all client-side. No sensitive data needs to leave your
                        device for the app to work.
                    </ProcessStep>

                    <ProcessStep stepNumber={3} title="Sync encrypted changes">
                        When you add/edit/remove assets, encrypt the changes
                        with <Tooltip
                            term="AES-256-GCM"
                            definition="Advanced Encryption Standard with 256-bit keys in Galois/Counter Mode: A standard modern encryption method"
                        /> and sync them. We store encrypted blobs that only you
                        can decrypt.
                    </ProcessStep>

                    <ProcessStep stepNumber={4} title="Access from anywhere">
                        Sign in from any device with your passkey/password,
                        regenerate the same encryption key, and decrypt your
                        synced data.
                    </ProcessStep>
                </div>
            </SecuritySection>

            <!-- Encrypted Data Demo -->
            <SecuritySection title="See What We Actually Store" iconName="demo">
                {#if user.isLoggedIn}
                    <p>
                        Since you're logged in, here's what your encrypted data
                        actually looks like on our servers. This is completely
                        unreadable to us - only you can decrypt it with your
                        key.
                    </p>
                {:else}
                    <p>
                        Here's what encrypted data looks like on our servers.
                        This example shows the format - completely unreadable
                        without the encryption key that only you have.
                    </p>
                {/if}

                <div
                    class="bg-base-300/30 border border-base-300/40 rounded-lg p-6 space-y-4 hover:border-base-300/60 transition-colors duration-200"
                >
                    <EncryptedDataItem
                        title="Portfolio Data:"
                        data={mockEncryptedData.portfolio}
                        label="portfolio data"
                    />

                    <EncryptedDataItem
                        title="Holdings Data:"
                        data={mockEncryptedData.holdings}
                        label="holdings data"
                    />

                    <EncryptedDataItem
                        title="Transaction History:"
                        data={mockEncryptedData.transactions}
                        label="transaction history"
                    />

                    {#if !user.isLoggedIn}
                        <InfoBox type="info" title="Example data format">
                            This shows the format of encrypted data we store. In
                            reality, each blob would be much longer and contain
                            your actual encrypted portfolio information. Click
                            the buttons to view the full example data.
                        </InfoBox>
                    {/if}
                </div>
            </SecuritySection>

            <!-- Learn More -->
            <Card title="Want to Learn More?" showHeader={true}>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <h4 class="font-medium text-base-content mb-3">
                            Passkeys & WebAuthn
                        </h4>
                        <div class="space-y-2">
                            <a
                                href="https://passkeys.dev/"
                                target="_blank"
                                rel="noopener noreferrer"
                                class="block text-sm text-primary hover:text-primary/80 underline decoration-dotted underline-offset-4 hover:decoration-solid transition-all duration-200 hover:translate-x-1"
                            >
                                Passkeys.dev - Good overview
                            </a>
                            <a
                                href="https://webauthn.guide/"
                                target="_blank"
                                rel="noopener noreferrer"
                                class="block text-sm text-primary hover:text-primary/80 underline decoration-dotted underline-offset-4 hover:decoration-solid transition-all duration-200 hover:translate-x-1"
                            >
                                WebAuthn Guide
                            </a>
                            <a
                                href="https://www.w3.org/TR/webauthn-2/"
                                target="_blank"
                                rel="noopener noreferrer"
                                class="block text-sm text-primary hover:text-primary/80 underline decoration-dotted underline-offset-4 hover:decoration-solid transition-all duration-200 hover:translate-x-1"
                            >
                                WebAuthn Spec
                            </a>
                        </div>
                    </div>

                    <div>
                        <h4 class="font-medium text-base-content mb-3">
                            PRF Extension
                        </h4>
                        <div class="space-y-2">
                            <a
                                href="https://github.com/w3c/webauthn/wiki/Explainer:-PRF-Extension"
                                target="_blank"
                                rel="noopener noreferrer"
                                class="block text-sm text-primary hover:text-primary/80 underline decoration-dotted underline-offset-4 hover:decoration-solid transition-all duration-200 hover:translate-x-1"
                            >
                                PRF Explainer on GitHub
                            </a>
                            <a
                                href="https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API"
                                target="_blank"
                                rel="noopener noreferrer"
                                class="block text-sm text-primary hover:text-primary/80 underline decoration-dotted underline-offset-4 hover:decoration-solid transition-all duration-200 hover:translate-x-1"
                            >
                                MDN Web Authentication API
                            </a>
                            <a
                                href="https://w3c.github.io/webauthn/#prf-extension"
                                target="_blank"
                                rel="noopener noreferrer"
                                class="block text-sm text-primary hover:text-primary/80 underline decoration-dotted underline-offset-4 hover:decoration-solid transition-all duration-200 hover:translate-x-1"
                            >
                                PRF Extension Spec
                            </a>
                        </div>
                    </div>
                </div>
            </Card>

            <!-- Back Button -->
            <div class="text-center pt-8">
                <a
                    href="/"
                    class="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-content rounded-lg hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/20 transition-all duration-200 group"
                >
                    <svg
                        class="w-4 h-4 group-hover:-translate-x-0.5 transition-transform duration-200"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M10 19l-7-7m0 0l7-7m-7 7h18"
                        />
                    </svg>
                    Back to Dashboard
                </a>
            </div>
        </div>
    </div>
</div>
