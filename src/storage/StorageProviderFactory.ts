import type { StorageProvider } from './StorageProvider.js';
import { LocalStorageProvider } from './local/LocalStorageProvider.js';
import { NfsStorageProvider } from './nfs/NfsStorageProvider.js';
import { GoogleDriveStorageProvider } from './google-drive/GoogleDriveStorageProvider.js';
import { ConfigurationError } from '../errors/StorageError.js';
import type { StorageConfig } from '../config/storage.config.js';
import { loadStorageConfig } from '../config/storage.config.js';

export function createStorageProvider(config = loadStorageConfig()): StorageProvider {
  switch (config.provider) {
    case 'local':
      return new LocalStorageProvider({
        basePath: config.localStoragePath,
      });

    case 'nfs':
      return new NfsStorageProvider({
        basePath: config.nfsStoragePath,
      });

    case 'google_drive':
      if (!config.googleDriveFolderId) {
        throw new ConfigurationError('GOOGLE_DRIVE_FOLDER_ID is required for google_drive provider');
      }
      return new GoogleDriveStorageProvider({
        rootFolderId: config.googleDriveFolderId,
      });

    default:
      throw new ConfigurationError(`Unsupported provider: ${(config as StorageConfig).provider}`);
  }
}
