import 'dotenv/config';
import path from 'node:path';

import type { StorageProviderName } from '../types/storage.types.js';
import { ConfigurationError } from '../errors/StorageError.js';

export interface StorageConfig {
  port: number;
  provider: StorageProviderName;
  maxFileSizeMb: number;
  maxFileSizeBytes: number;
  localStoragePath: string;
  nfsStoragePath: string;
  googleDriveFolderId?: string;
  googleApplicationCredentials?: string;
}

export function loadStorageConfig(): StorageConfig {
  const provider = readProviderName(process.env.STORAGE_PROVIDER ?? 'local');
  const port = parsePositiveInt(process.env.PORT ?? '3000', 'PORT');
  const maxFileSizeMb = parsePositiveInt(process.env.MAX_FILE_SIZE_MB ?? '100', 'MAX_FILE_SIZE_MB');

  const config: StorageConfig = {
    port,
    provider,
    maxFileSizeMb,
    maxFileSizeBytes: maxFileSizeMb * 1024 * 1024,
    localStoragePath: path.resolve(process.env.LOCAL_STORAGE_PATH ?? './uploads'),
    nfsStoragePath: path.resolve(process.env.NFS_STORAGE_PATH ?? '/mnt/app-files'),
    googleDriveFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID,
    googleApplicationCredentials: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  };

  validateProviderConfig(config);
  return config;
}

function validateProviderConfig(config: StorageConfig): void {
  if (config.provider === 'google_drive') {
    if (!config.googleDriveFolderId) {
      throw new ConfigurationError('GOOGLE_DRIVE_FOLDER_ID is required when STORAGE_PROVIDER=google_drive');
    }

    if (!config.googleApplicationCredentials) {
      throw new ConfigurationError(
        'GOOGLE_APPLICATION_CREDENTIALS is required when STORAGE_PROVIDER=google_drive',
      );
    }
  }

  if (config.provider === 'nfs' && !config.nfsStoragePath) {
    throw new ConfigurationError('NFS_STORAGE_PATH is required when STORAGE_PROVIDER=nfs');
  }
}

function parsePositiveInt(raw: string, key: string): number {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new ConfigurationError(`${key} must be a positive integer`);
  }
  return value;
}

function readProviderName(raw: string): StorageProviderName {
  if (raw === 'local' || raw === 'nfs' || raw === 'google_drive') {
    return raw;
  }
  throw new ConfigurationError('STORAGE_PROVIDER must be one of: local, nfs, google_drive');
}
