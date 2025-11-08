/**
 * Credential Types - Provider API Key Management
 *
 * Separates credentials (API keys, secrets) from provider configuration.
 * Supports multiple credentials per provider and different scopes.
 */

/**
 * Credential scope
 * Determines where the credential is stored and accessible
 */
export type CredentialScope =
  | 'global'   // ~/.sylphx-code/credentials.json (user-wide)
  | 'project'; // ./.sylphx-code/credentials.local.json (project-specific, gitignored)

/**
 * Credential status
 */
export type CredentialStatus =
  | 'active'     // Currently usable
  | 'expired'    // Past expiration date
  | 'revoked'    // Manually revoked
  | 'invalid';   // Failed validation

/**
 * Provider credential entity
 * Stores API keys and secrets for AI providers
 */
export interface ProviderCredential {
  /** Unique credential ID (auto-generated) */
  id: string;

  /** Provider this credential belongs to */
  providerId: string;

  /** Display label for this credential */
  label?: string;

  /** API key or secret (currently plaintext, TODO: add encryption) */
  apiKey: string;

  /** Credential scope */
  scope: CredentialScope;

  /** Whether this is the default credential for the provider */
  isDefault: boolean;

  /** Credential status */
  status: CredentialStatus;

  /** When the credential was created */
  createdAt: number;

  /** When the credential was last used */
  lastUsedAt?: number;

  /** Optional expiration date */
  expiresAt?: number;

  /** Additional metadata */
  metadata?: {
    /** Associated project path (for project scope) */
    projectPath?: string;

    /** Environment this credential is for (dev, staging, prod) */
    environment?: string;

    /** Custom tags */
    tags?: string[];
  };
}

/**
 * Credential creation input
 * Used when adding a new credential
 */
export interface CreateCredentialInput {
  providerId: string;
  label?: string;
  apiKey: string;
  scope: CredentialScope;
  isDefault?: boolean;
  expiresAt?: number;
  metadata?: ProviderCredential['metadata'];
}

/**
 * Credential update input
 * Used when updating an existing credential
 */
export interface UpdateCredentialInput {
  label?: string;
  apiKey?: string;
  isDefault?: boolean;
  status?: CredentialStatus;
  expiresAt?: number;
  metadata?: ProviderCredential['metadata'];
}

/**
 * Credential with masked API key
 * For display purposes (UI, logs, etc.)
 */
export interface MaskedCredential extends Omit<ProviderCredential, 'apiKey'> {
  /** Masked API key (e.g., "sk-...abc123") */
  maskedApiKey: string;
}

/**
 * Credential validation result
 */
export interface CredentialValidation {
  /** Credential ID */
  credentialId: string;

  /** Whether the credential is valid */
  isValid: boolean;

  /** Error message if invalid */
  error?: string;

  /** When the validation was performed */
  validatedAt: number;
}
