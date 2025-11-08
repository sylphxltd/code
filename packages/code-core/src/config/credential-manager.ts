/**
 * Credential Manager
 *
 * Handles loading and saving credentials to/from filesystem.
 * Credentials are stored in separate files from general configuration.
 *
 * File locations:
 * - Global: ~/.sylphx-code/credentials.json (user-wide API keys)
 * - Project: ./.sylphx-code/credentials.local.json (project-specific, gitignored)
 *
 * NOTE: Currently stores credentials in plaintext JSON.
 * TODO: Add encryption layer for production use.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { z } from 'zod';
import { type Result, success, failure, tryCatchAsync } from '../ai/functional/result.js';
import type { ProviderCredential, CreateCredentialInput, CredentialScope } from '../types/credential.types.js';
import {
  getAllCredentials,
  getCredential,
  getCredentialsByProvider,
  getDefaultCredential,
  getCredentialsByScope,
  createCredential,
  updateCredential,
  deleteCredential,
  registerCredential,
  clearCredentialRegistry,
  hasActiveCredential,
} from '../registry/credential-registry.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('CredentialManager');

/**
 * Credential file schema
 */
const credentialFileSchema = z.object({
  version: z.literal(1),
  credentials: z.array(
    z.object({
      id: z.string(),
      providerId: z.string(),
      label: z.string().optional(),
      apiKey: z.string(),
      scope: z.enum(['global', 'project']),
      isDefault: z.boolean(),
      status: z.enum(['active', 'expired', 'revoked', 'invalid']),
      createdAt: z.number(),
      lastUsedAt: z.number().optional(),
      expiresAt: z.number().optional(),
      metadata: z
        .object({
          projectPath: z.string().optional(),
          environment: z.string().optional(),
          tags: z.array(z.string()).optional(),
        })
        .optional(),
    })
  ),
});

type CredentialFile = z.infer<typeof credentialFileSchema>;

/**
 * Credential file paths
 */
const GLOBAL_CREDENTIALS_FILE = path.join(os.homedir(), '.sylphx-code', 'credentials.json');

function getProjectCredentialsFile(cwd: string): string {
  return path.join(cwd, '.sylphx-code', 'credentials.local.json');
}

/**
 * Get all credential file paths
 */
export function getCredentialPaths(cwd: string = process.cwd()): {
  global: string;
  project: string;
} {
  return {
    global: GLOBAL_CREDENTIALS_FILE,
    project: getProjectCredentialsFile(cwd),
  };
}

/**
 * Load credentials from a file
 */
async function loadCredentialFile(filePath: string): Promise<ProviderCredential[]> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(content);
    const validated = credentialFileSchema.parse(parsed);
    return validated.credentials;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return []; // File doesn't exist
    }
    logger.error('Failed to load credential file', { filePath, error: error.message });
    throw error;
  }
}

/**
 * Save credentials to a file
 */
async function saveCredentialFile(
  filePath: string,
  credentials: ProviderCredential[]
): Promise<void> {
  const credentialFile: CredentialFile = {
    version: 1,
    credentials,
  };

  // Ensure directory exists
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  // Write file with restrictive permissions (0600 = rw-------)
  await fs.writeFile(filePath, JSON.stringify(credentialFile, null, 2) + '\n', {
    mode: 0o600,
  });
}

/**
 * Load all credentials from filesystem
 * Merges global and project credentials into registry
 */
export async function loadCredentials(
  cwd: string = process.cwd()
): Promise<Result<void, Error>> {
  return tryCatchAsync(
    async () => {
      const paths = getCredentialPaths(cwd);

      // Clear registry before loading
      clearCredentialRegistry();

      // Load global and project credentials
      const [globalCreds, projectCreds] = await Promise.all([
        loadCredentialFile(paths.global),
        loadCredentialFile(paths.project),
      ]);

      // Register all credentials
      for (const cred of [...globalCreds, ...projectCreds]) {
        registerCredential(cred);
      }

      logger.info('Credentials loaded', {
        global: globalCreds.length,
        project: projectCreds.length,
      });
    },
    (error: any) => new Error(`Failed to load credentials: ${error.message}`)
  );
}

/**
 * Save credentials to filesystem
 * Separates global and project credentials
 */
export async function saveCredentials(
  cwd: string = process.cwd()
): Promise<Result<void, Error>> {
  return tryCatchAsync(
    async () => {
      const paths = getCredentialPaths(cwd);

      // Separate credentials by scope
      const globalCreds = getCredentialsByScope('global');
      const projectCreds = getCredentialsByScope('project');

      // Save to respective files
      await Promise.all([
        saveCredentialFile(paths.global, globalCreds),
        projectCreds.length > 0
          ? saveCredentialFile(paths.project, projectCreds)
          : Promise.resolve(),
      ]);

      logger.info('Credentials saved', {
        global: globalCreds.length,
        project: projectCreds.length,
      });
    },
    (error: any) => new Error(`Failed to save credentials: ${error.message}`)
  );
}

/**
 * Add a new credential
 * Automatically saves to filesystem
 */
export async function addCredential(
  input: CreateCredentialInput,
  cwd: string = process.cwd()
): Promise<Result<ProviderCredential, Error>> {
  return tryCatchAsync(
    async () => {
      const credential = createCredential(input);
      const saveResult = await saveCredentials(cwd);

      if (saveResult._tag === 'Failure') {
        // Rollback: remove from registry
        deleteCredential(credential.id);
        throw saveResult.error;
      }

      return credential;
    },
    (error: any) => new Error(`Failed to add credential: ${error.message}`)
  );
}

/**
 * Remove a credential
 * Automatically saves to filesystem
 */
export async function removeCredential(
  credentialId: string,
  cwd: string = process.cwd()
): Promise<Result<boolean, Error>> {
  return tryCatchAsync(
    async () => {
      const credential = getCredential(credentialId);
      if (!credential) {
        return false;
      }

      const deleted = deleteCredential(credentialId);
      if (deleted) {
        const saveResult = await saveCredentials(cwd);
        if (saveResult._tag === 'Failure') {
          // Rollback: re-add to registry
          registerCredential(credential);
          throw saveResult.error;
        }
      }

      return deleted;
    },
    (error: any) => new Error(`Failed to remove credential: ${error.message}`)
  );
}

/**
 * Update a credential
 * Automatically saves to filesystem
 */
export async function modifyCredential(
  credentialId: string,
  updates: Parameters<typeof updateCredential>[1],
  cwd: string = process.cwd()
): Promise<Result<ProviderCredential | null, Error>> {
  return tryCatchAsync(
    async () => {
      const original = getCredential(credentialId);
      if (!original) {
        return null;
      }

      const updated = updateCredential(credentialId, updates);
      if (updated) {
        const saveResult = await saveCredentials(cwd);
        if (saveResult._tag === 'Failure') {
          // Rollback: restore original
          registerCredential(original);
          throw saveResult.error;
        }
      }

      return updated;
    },
    (error: any) => new Error(`Failed to update credential: ${error.message}`)
  );
}

/**
 * Check if credentials exist
 */
export async function credentialsExist(cwd: string = process.cwd()): Promise<boolean> {
  const paths = getCredentialPaths(cwd);

  try {
    await fs.access(paths.global);
    return true;
  } catch {
    // Global doesn't exist, check project
  }

  try {
    await fs.access(paths.project);
    return true;
  } catch {
    return false;
  }
}

/**
 * Migrate API keys from provider config to credentials
 * Used during transition from old config structure
 */
export async function migrateProviderConfigToCredentials(
  providerConfigs: Record<string, any>,
  cwd: string = process.cwd()
): Promise<Result<number, Error>> {
  return tryCatchAsync(
    async () => {
      let migratedCount = 0;

      for (const [providerId, config] of Object.entries(providerConfigs)) {
        // Check if this provider config has an API key
        if (!config.apiKey || typeof config.apiKey !== 'string') {
          continue;
        }

        // Check if we already have a credential for this provider
        if (hasActiveCredential(providerId)) {
          logger.info('Credential already exists for provider, skipping migration', {
            providerId,
          });
          continue;
        }

        // Create credential from API key
        createCredential({
          providerId,
          label: `Migrated from config`,
          apiKey: config.apiKey,
          scope: 'global',
          isDefault: true,
        });

        migratedCount++;
      }

      if (migratedCount > 0) {
        const saveResult = await saveCredentials(cwd);
        if (saveResult._tag === 'Failure') {
          throw saveResult.error;
        }

        logger.info('Migrated API keys to credential system', { count: migratedCount });
      }

      return migratedCount;
    },
    (error: any) => new Error(`Failed to migrate credentials: ${error.message}`)
  );
}

// Re-export registry functions for convenience
export {
  getAllCredentials,
  getCredential,
  getCredentialsByProvider,
  getDefaultCredential,
  hasActiveCredential,
};
