import type { Readable } from 'node:stream';
import type { StoredFile, UploadInput } from '../types/storage.types.js';

export interface StorageProvider {
  upload(input: UploadInput): Promise<StoredFile>;
  download(storageId: string): Promise<Readable>;
  delete(storageId: string): Promise<void>;
  exists(storageId: string): Promise<boolean>;
  getMetadata(storageId: string): Promise<StoredFile>;
  list?(prefix?: string): Promise<StoredFile[]>;
}
