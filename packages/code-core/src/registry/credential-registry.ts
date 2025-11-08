/**
 * Credential Registry
 *
 * Centralized registry for provider credentials (API keys).
 * Manages credential storage, retrieval, and validation.
 *
 * NOTE: Currently stores credentials in plaintext JSON files.
 * TODO: Add encryption layer (AES-256-GCM) for production use.
 */

import type {
  ProviderCredential,
  CreateCredentialInput,
  UpdateCredentialInput,
  MaskedCredential,
  CredentialScope,
  CredentialStatus,
} from '../types/credential.types.js';

/**
 * In-memory credential registry
 * Loaded from credential files on startup
 */
const credentials: Map<string, ProviderCredential> = new Map();

/**
 * Generate unique credential ID
 */
function generateCredentialId(): string {
  return `cred_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Mask API key for display
 * Shows first 3-4 and last 4 characters
 */
export function maskApiKey(apiKey: string): string {
  if (!apiKey || apiKey.length < 8) {
    return '***';
  }

  const prefixLength = apiKey.startsWith('sk-') ? 7 : 4; // OpenAI keys start with sk-
  const prefix = apiKey.substring(0, prefixLength);
  const suffix = apiKey.substring(apiKey.length - 4);

  return `${prefix}...${suffix}`;
}

/**
 * Get all credentials
 */
export function getAllCredentials(): ProviderCredential[] {
  return Array.from(credentials.values());
}

/**
 * Get credential by ID
 */
export function getCredential(credentialId: string): ProviderCredential | undefined {
  return credentials.get(credentialId);
}

/**
 * Get credentials for a specific provider
 */
export function getCredentialsByProvider(providerId: string): ProviderCredential[] {
  return Array.from(credentials.values()).filter(
    (cred) => cred.providerId === providerId
  );
}

/**
 * Get default credential for a provider
 */
export function getDefaultCredential(providerId: string): ProviderCredential | undefined {
  const providerCredentials = getCredentialsByProvider(providerId);
  return providerCredentials.find((cred) => cred.isDefault && cred.status === 'active');
}

/**
 * Get active credentials (not expired or revoked)
 */
export function getActiveCredentials(): ProviderCredential[] {
  const now = Date.now();
  return Array.from(credentials.values()).filter((cred) => {
    if (cred.status !== 'active') return false;
    if (cred.expiresAt && cred.expiresAt < now) return false;
    return true;
  });
}

/**
 * Get credentials by scope
 */
export function getCredentialsByScope(scope: CredentialScope): ProviderCredential[] {
  return Array.from(credentials.values()).filter((cred) => cred.scope === scope);
}

/**
 * Create a new credential
 */
export function createCredential(input: CreateCredentialInput): ProviderCredential {
  const credential: ProviderCredential = {
    id: generateCredentialId(),
    providerId: input.providerId,
    label: input.label,
    apiKey: input.apiKey,
    scope: input.scope,
    isDefault: input.isDefault ?? false,
    status: 'active',
    createdAt: Date.now(),
    expiresAt: input.expiresAt,
    metadata: input.metadata,
  };

  // If this is set as default, unset other defaults for the same provider
  if (credential.isDefault) {
    for (const cred of credentials.values()) {
      if (cred.providerId === credential.providerId && cred.id !== credential.id) {
        cred.isDefault = false;
      }
    }
  }

  credentials.set(credential.id, credential);
  return credential;
}

/**
 * Update a credential
 */
export function updateCredential(
  credentialId: string,
  updates: UpdateCredentialInput
): ProviderCredential | null {
  const credential = credentials.get(credentialId);
  if (!credential) {
    return null;
  }

  // Apply updates
  if (updates.label !== undefined) credential.label = updates.label;
  if (updates.apiKey !== undefined) credential.apiKey = updates.apiKey;
  if (updates.status !== undefined) credential.status = updates.status;
  if (updates.expiresAt !== undefined) credential.expiresAt = updates.expiresAt;
  if (updates.metadata !== undefined) {
    credential.metadata = { ...credential.metadata, ...updates.metadata };
  }

  // Handle isDefault change
  if (updates.isDefault !== undefined && updates.isDefault !== credential.isDefault) {
    if (updates.isDefault) {
      // Unset other defaults for the same provider
      for (const cred of credentials.values()) {
        if (cred.providerId === credential.providerId && cred.id !== credentialId) {
          cred.isDefault = false;
        }
      }
    }
    credential.isDefault = updates.isDefault;
  }

  return credential;
}

/**
 * Delete a credential
 */
export function deleteCredential(credentialId: string): boolean {
  return credentials.delete(credentialId);
}

/**
 * Mark credential as used (updates lastUsedAt)
 */
export function markCredentialUsed(credentialId: string): void {
  const credential = credentials.get(credentialId);
  if (credential) {
    credential.lastUsedAt = Date.now();
  }
}

/**
 * Revoke a credential
 */
export function revokeCredential(credentialId: string): boolean {
  const credential = credentials.get(credentialId);
  if (!credential) {
    return false;
  }

  credential.status = 'revoked';
  return true;
}

/**
 * Get credential with masked API key
 */
export function getMaskedCredential(credentialId: string): MaskedCredential | undefined {
  const credential = credentials.get(credentialId);
  if (!credential) {
    return undefined;
  }

  const { apiKey, ...rest } = credential;
  return {
    ...rest,
    maskedApiKey: maskApiKey(apiKey),
  };
}

/**
 * Get all credentials with masked API keys
 */
export function getAllMaskedCredentials(): MaskedCredential[] {
  return Array.from(credentials.values()).map((cred) => {
    const { apiKey, ...rest } = cred;
    return {
      ...rest,
      maskedApiKey: maskApiKey(apiKey),
    };
  });
}

/**
 * Register a credential in the registry
 * Used when loading from storage
 */
export function registerCredential(credential: ProviderCredential): void {
  credentials.set(credential.id, credential);
}

/**
 * Clear all credentials from registry
 * Useful for testing or reset
 */
export function clearCredentialRegistry(): void {
  credentials.clear();
}

/**
 * Get credential statistics
 */
export function getCredentialStats() {
  const allCreds = Array.from(credentials.values());
  const now = Date.now();

  return {
    total: allCreds.length,
    active: allCreds.filter((c) => c.status === 'active').length,
    expired: allCreds.filter(
      (c) => c.expiresAt && c.expiresAt < now
    ).length,
    revoked: allCreds.filter((c) => c.status === 'revoked').length,
    byProvider: allCreds.reduce((acc, cred) => {
      acc[cred.providerId] = (acc[cred.providerId] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    byScope: {
      global: allCreds.filter((c) => c.scope === 'global').length,
      project: allCreds.filter((c) => c.scope === 'project').length,
    },
  };
}

/**
 * Check if a provider has any active credentials
 */
export function hasActiveCredential(providerId: string): boolean {
  const now = Date.now();
  return Array.from(credentials.values()).some(
    (cred) =>
      cred.providerId === providerId &&
      cred.status === 'active' &&
      (!cred.expiresAt || cred.expiresAt > now)
  );
}

/**
 * Auto-expire credentials
 * Should be called periodically to update expired credentials
 */
export function autoExpireCredentials(): number {
  const now = Date.now();
  let expiredCount = 0;

  for (const credential of credentials.values()) {
    if (
      credential.status === 'active' &&
      credential.expiresAt &&
      credential.expiresAt < now
    ) {
      credential.status = 'expired';
      expiredCount++;
    }
  }

  return expiredCount;
}
