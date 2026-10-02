import { FilesystemStorageProvider } from '../base/FilesystemStorageProvider.js';

interface NfsStorageProviderOptions {
  basePath: string;
}

export class NfsStorageProvider extends FilesystemStorageProvider {
  constructor(options: NfsStorageProviderOptions) {
    super({
      basePath: options.basePath,
      providerName: 'nfs',
    });
  }
}
