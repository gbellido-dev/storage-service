import { FilesystemStorageProvider } from '../base/FilesystemStorageProvider.js';

interface LocalStorageProviderOptions {
  basePath: string;
}

export class LocalStorageProvider extends FilesystemStorageProvider {
  constructor(options: LocalStorageProviderOptions) {
    super({
      basePath: options.basePath,
      providerName: 'local',
    });
  }
}
