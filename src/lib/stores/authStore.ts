import { writable } from 'svelte/store';
import type { AuthState, User, EncryptionKeyOptions } from '$lib/types/user';

// Constants
const SIMULATION_DELAYS = {
    SSO_AUTH: 1500,
    ENCRYPTION_SETUP: 2000,
    PASSKEY_AUTH: 1200,
    PASSWORD_AUTH: 800,
    DEMO_SETUP: 500,
} as const;

const USER_IDS = {
    REGULAR: 'usr_7f3a9b2c8e1d4f6a',
    DEMO: 'demo_user',
} as const;

const ERROR_MESSAGES = {
    AUTH_FAILED: 'Authentication failed',
    ENCRYPTION_SETUP_FAILED: 'Failed to setup encryption key',
    UNLOCK_FAILED: 'Failed to unlock encryption',
    PASSKEY_FAILED: 'Passkey authentication failed',
    PASSWORD_FAILED: 'Invalid password',
    DECRYPT_FAILED: 'Failed to decrypt data - incorrect credentials',
    DEMO_FAILED: 'Demo mode failed to initialize',
} as const;

// Create the auth store
function createAuthStore() {
    const { subscribe, set, update } = writable<AuthState>({
        user: null,
        isLoading: false,
        error: null,
        authStep: 'sso'
    });

    // Helper functions
    const updateState = (updates: Partial<AuthState>) => {
        update(state => ({ ...state, ...updates }));
    };

    const setLoading = (isLoading: boolean) => {
        updateState({ isLoading, error: null });
    };

    const setError = (error: string) => {
        updateState({ isLoading: false, error });
    };

    const createUser = (id: string, userData: any, isDemoMode = false): User => ({
        id,
        email: '',
        name: '',
        isLoggedIn: true,
        hasEncryptionKey: userData.hasEncryptedData,
        isFirstTime: !userData.hasEncryptedData,
        encryptionMethod: userData.derivationMethod,
        isDemoMode
    });

    const simulateDelay = (duration: number) => new Promise(resolve => setTimeout(resolve, duration));

    return {
        subscribe,

        // Passkey-only SSO Authentication
        async authenticateWithSSO() {
            setLoading(true);

            try {
                // Simulate passkey authentication
                await simulateDelay(SIMULATION_DELAYS.SSO_AUTH);

                // Check if user has existing encrypted data and get derivation method
                const userData = await this.checkUserEncryptionStatus();
                const user = createUser(USER_IDS.REGULAR, userData);

                updateState({
                    user,
                    isLoading: false,
                    authStep: userData.hasEncryptedData ? 'encryption-unlock' : 'encryption-setup'
                });

                return user;
            } catch (error) {
                setError(ERROR_MESSAGES.AUTH_FAILED);
                throw error;
            }
        },

        // Encryption Key Setup (first time users)
        async setupEncryptionKey(options: EncryptionKeyOptions) {
            setLoading(true);

            try {
                if (options.type === 'passkey') {
                    await this.setupPasskey();
                } else {
                    await this.setupPassword(options.data as string);
                }

                update(state => ({
                    ...state,
                    user: state.user ? {
                        ...state.user,
                        hasEncryptionKey: true,
                        isFirstTime: false,
                        encryptionMethod: options.type
                    } : null,
                    isLoading: false,
                    authStep: 'authenticated'
                }));
            } catch (error) {
                setError(ERROR_MESSAGES.ENCRYPTION_SETUP_FAILED);
                throw error;
            }
        },

        // Unlock existing encryption (returning users)
        async unlockEncryption(method: 'passkey' | 'password', data?: string) {
            update(state => ({ ...state, isLoading: true, error: null }));

            try {
                let derivedKey;

                if (method === 'passkey') {
                    derivedKey = await this.authenticatePasskey();
                } else if (data) {
                    derivedKey = await this.authenticatePassword(data);
                } else {
                    throw new Error('Password required');
                }

                // Attempt to decrypt user's data with the derived key
                await this.testDecryption(derivedKey);

                update(state => ({
                    ...state,
                    isLoading: false,
                    authStep: 'authenticated'
                }));
            } catch (error) {
                let errorMessage = 'Failed to unlock encryption';

                if (error instanceof Error) {
                    if (error.message.includes('decrypt') || error.message.includes('invalid')) {
                        if (method === 'password') {
                            errorMessage = 'Incorrect password. Please try again.';
                        } else {
                            errorMessage = 'Unable to decrypt data with passkey. Data may be corrupted.';
                        }
                    } else if (error.message.includes('WebAuthn') || error.message.includes('supported')) {
                        errorMessage = 'Passkey authentication not available on this device.';
                    } else {
                        errorMessage = error.message;
                    }
                }

                update(state => ({
                    ...state,
                    isLoading: false,
                    error: errorMessage
                }));
                throw error;
            }
        },

        // Handle data recovery when decryption fails
        async initiateDataRecovery() {
            update(state => ({ ...state, isLoading: true, error: null }));

            try {
                // In a real app, this might:
                // 1. Export encrypted data for manual recovery
                // 2. Initiate account reset process
                // 3. Contact support workflow
                await new Promise(resolve => setTimeout(resolve, 1000));

                update(state => ({
                    ...state,
                    isLoading: false,
                    authStep: 'data-recovery'
                }));
            } catch (error) {
                update(state => ({
                    ...state,
                    isLoading: false,
                    error: 'Recovery process failed'
                }));
            }
        },

        // Reset user account (destructive action)
        async resetAccount() {
            update(state => ({ ...state, isLoading: true, error: null }));

            try {
                // In a real app, this would delete all encrypted data
                await new Promise(resolve => setTimeout(resolve, 1500));

                update(state => ({
                    ...state,
                    user: state.user ? {
                        ...state.user,
                        hasEncryptionKey: false,
                        isFirstTime: true,
                        encryptionMethod: undefined
                    } : null,
                    isLoading: false,
                    authStep: 'encryption-setup'
                }));
            } catch (error) {
                update(state => ({
                    ...state,
                    isLoading: false,
                    error: 'Failed to reset account'
                }));
            }
        },

        async setupPasskey() {
            // Create passkey with PRF extension for key derivation
            if (!navigator.credentials) {
                throw new Error('WebAuthn is not supported');
            }

            // In a real implementation, you'd:
            // 1. Create WebAuthn credential with PRF extension
            // 2. Use the PRF output as encryption key material
            await new Promise(resolve => setTimeout(resolve, 1000));
        },

        async setupPassword(password: string) {
            if (password.length < 8) {
                throw new Error('Password must be at least 8 characters');
            }

            // Derive encryption key from password using PBKDF2/Argon2
            await new Promise(resolve => setTimeout(resolve, 500));
        },

        async authenticatePasskey() {
            // Authenticate with passkey and derive encryption key using PRF
            if (!navigator.credentials) {
                throw new Error('WebAuthn is not supported');
            }

            // In a real implementation, you'd:
            // 1. Authenticate with existing passkey
            // 2. Use PRF extension to derive the same encryption key
            await new Promise(resolve => setTimeout(resolve, 800));

            // Return simulated key (in real app, this would be the actual derived key)
            return new Uint8Array(32); // 256-bit key
        },

        async authenticatePassword(password: string) {
            if (password.length < 1) {
                throw new Error('Password required');
            }

            // Derive encryption key from password and verify against stored data
            await new Promise(resolve => setTimeout(resolve, 500));

            // Return simulated key (in real app, this would be PBKDF2/Argon2 output)
            return new Uint8Array(32); // 256-bit key
        },

        // Test if the derived key can actually decrypt the user's data
        async testDecryption(key: Uint8Array) {
            // Simulate attempting to decrypt a small piece of user data
            await new Promise(resolve => setTimeout(resolve, 200));

            // For demo purposes, simulate decryption failures more often to test error handling
            // In a real app, you'd try to decrypt actual data
            const decryptionSuccess = Math.random() > 0.4; // 60% success rate for demo

            if (!decryptionSuccess) {
                throw new Error('Failed to decrypt data - invalid encryption key');
            }

            return true;
        },

        // Check if user has existing encrypted data and get the derivation method
        async checkUserEncryptionStatus() {
            // Simulate API call to check if user has encrypted data
            // In a real app, this would query your backend for the user's encrypted blob
            await new Promise(resolve => setTimeout(resolve, 300));

            // For demo purposes, randomly simulate different scenarios
            const scenarios = [
                { hasEncryptedData: false, derivationMethod: undefined }, // First time user
                { hasEncryptedData: true, derivationMethod: 'passkey' as const }, // Returning passkey user
                { hasEncryptedData: true, derivationMethod: 'password' as const }, // Returning password user
            ];

            // Pick a random scenario (in real app, this would be determined by checking the encrypted blob metadata)
            const scenario = scenarios[Math.floor(Math.random() * scenarios.length)];

            return scenario;
        },

        // Demo Mode (no authentication required)
        async enterDemoMode() {
            update(state => ({ ...state, isLoading: true, error: null }));

            try {
                await new Promise(resolve => setTimeout(resolve, 800)); // Simulate loading

                const demoUser: User = {
                    id: 'demo_user',
                    email: '',
                    name: '',
                    isLoggedIn: true,
                    hasEncryptionKey: true,
                    isFirstTime: false,
                    encryptionMethod: 'demo'
                };

                update(state => ({
                    ...state,
                    user: demoUser,
                    isLoading: false,
                    authStep: 'authenticated'
                }));

                return demoUser;
            } catch (error) {
                update(state => ({
                    ...state,
                    isLoading: false,
                    error: 'Failed to enter demo mode'
                }));
                throw error;
            }
        },

        // Logout
        logout() {
            set({
                user: null,
                isLoading: false,
                error: null,
                authStep: 'sso'
            });
        },

        // Clear error
        clearError() {
            update(state => ({ ...state, error: null }));
        }
    };
}

export const authStore = createAuthStore();
