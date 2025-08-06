export interface User {
    id: string;
    email: string;
    name: string;
    isLoggedIn: boolean;
    hasEncryptionKey: boolean;
    isFirstTime?: boolean;
    encryptionMethod?: 'passkey' | 'password' | 'demo';
    isDemoMode?: boolean;
}

export interface AuthState {
    user: User | null;
    isLoading: boolean;
    error: string | null;
    authStep: 'sso' | 'encryption-setup' | 'encryption-unlock' | 'authenticated' | 'data-recovery';
}

export interface EncryptionKeyOptions {
    type: 'passkey' | 'password';
    data: string | ArrayBuffer;
}
