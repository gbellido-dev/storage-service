import type { Readable } from 'node:stream';

export type StorageProviderName = 'local' | 'nfs' | 'google_drive';

export interface UploadContext {
  courseId?: string;
  assignmentId?: string;
  userId?: string;
}

export interface UploadInput {
  stream: Readable;
  originalName: string;
  mimeType?: string;
  size?: number;
  context?: UploadContext;
}

export interface StoredFile {
  provider: StorageProviderName;
  storageId: string;
  originalName: string;
  mimeType?: string;
  size: number;
  sha256: string;
  createdAt: Date;
  metadata?: Record<string, unknown>;
}

export interface StoredFileSidecar {
  originalName: string;
  mimeType?: string;
  size: number;
  sha256: string;
  createdAt: string;
  context?: UploadContext;
}
