import { PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { google, drive_v3 } from 'googleapis';

import type { StorageProvider } from '../StorageProvider.js';
import type { StoredFile, UploadContext, UploadInput } from '../../types/storage.types.js';
import { buildInternalFilename, sanitizePathSegment } from '../../utils/filenames.js';
import { HashAndSizeTransform } from '../../utils/hash.js';
import { FileNotFoundError, StorageError } from '../../errors/StorageError.js';

interface GoogleDriveStorageProviderOptions {
  rootFolderId: string;
}

export class GoogleDriveStorageProvider implements StorageProvider {
  private readonly drive: drive_v3.Drive;
  private readonly rootFolderId: string;
  private readonly folderCache = new Map<string, string>();

  constructor(options: GoogleDriveStorageProviderOptions) {
    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/drive'],
    });

    this.drive = google.drive({ version: 'v3', auth });
    this.rootFolderId = options.rootFolderId;
    this.folderCache.set('root', options.rootFolderId);
  }

  public async upload(input: UploadInput): Promise<StoredFile> {
    const parentFolderId = await this.ensureContextFolder(input.context);
    const internalName = buildInternalFilename(input.originalName);

    const hashTransform = new HashAndSizeTransform();
    const passThrough = new PassThrough();

    const streamPromise = pipeline(input.stream, hashTransform, passThrough);

    const createPromise = this.drive.files.create({
      requestBody: {
        name: internalName,
        parents: [parentFolderId],
        appProperties: this.buildAppProperties({
          originalName: input.originalName,
          context: input.context,
        }),
      },
      media: {
        mimeType: input.mimeType ?? 'application/octet-stream',
        body: passThrough,
      },
      fields: 'id,createdTime,mimeType,size',
    });

    const [, createResult] = await Promise.all([streamPromise, createPromise]);
    const fileId = createResult.data.id;

    if (!fileId) {
      throw new StorageError('UPLOAD_FAILED', 'Google Drive upload did not return a file id', 502);
    }

    const sha256 = hashTransform.digestHex();
    const size = hashTransform.size;

    await this.drive.files.update({
      fileId,
      requestBody: {
        appProperties: this.buildAppProperties({
          originalName: input.originalName,
          sha256,
          size,
          context: input.context,
        }),
      },
      fields: 'id',
    });

    return {
      provider: 'google_drive',
      storageId: fileId,
      originalName: input.originalName,
      mimeType: createResult.data.mimeType ?? input.mimeType,
      size,
      sha256,
      createdAt: createResult.data.createdTime ? new Date(createResult.data.createdTime) : new Date(),
      metadata: {
        fileNameInDrive: internalName,
      },
    };
  }

  public async download(storageId: string) {
    try {
      const response = await this.drive.files.get(
        {
          fileId: storageId,
          alt: 'media',
        },
        {
          responseType: 'stream',
        },
      );

      return response.data;
    } catch (error) {
      if (isNotFound(error)) {
        throw new FileNotFoundError();
      }
      throw error;
    }
  }

  public async delete(storageId: string): Promise<void> {
    try {
      await this.drive.files.delete({ fileId: storageId });
    } catch (error) {
      if (isNotFound(error)) {
        throw new FileNotFoundError();
      }
      throw error;
    }
  }

  public async exists(storageId: string): Promise<boolean> {
    try {
      await this.drive.files.get({ fileId: storageId, fields: 'id' });
      return true;
    } catch (error) {
      if (isNotFound(error)) {
        return false;
      }
      throw error;
    }
  }

  public async getMetadata(storageId: string): Promise<StoredFile> {
    try {
      const response = await this.drive.files.get({
        fileId: storageId,
        fields: 'id,name,mimeType,size,createdTime,modifiedTime,appProperties',
      });

      const data = response.data;
      const app = data.appProperties ?? {};

      return {
        provider: 'google_drive',
        storageId: data.id ?? storageId,
        originalName: app.originalName ?? data.name ?? storageId,
        mimeType: data.mimeType ?? undefined,
        size: Number.parseInt(data.size ?? '0', 10),
        sha256: app.sha256 ?? '',
        createdAt: data.createdTime ? new Date(data.createdTime) : new Date(),
        metadata: {
          modifiedTime: data.modifiedTime,
          context: {
            courseId: app.courseId,
            assignmentId: app.assignmentId,
            userId: app.userId,
          },
        },
      };
    } catch (error) {
      if (isNotFound(error)) {
        throw new FileNotFoundError();
      }
      throw error;
    }
  }

  public async list(): Promise<StoredFile[]> {
    const response = await this.drive.files.list({
      q: `'${this.rootFolderId}' in parents and trashed=false`,
      fields: 'files(id,name,mimeType,size,createdTime,modifiedTime,appProperties)',
      pageSize: 200,
    });

    return (response.data.files ?? []).map((file) => ({
      provider: 'google_drive',
      storageId: file.id ?? '',
      originalName: file.appProperties?.originalName ?? file.name ?? file.id ?? '',
      mimeType: file.mimeType ?? undefined,
      size: Number.parseInt(file.size ?? '0', 10),
      sha256: file.appProperties?.sha256 ?? '',
      createdAt: file.createdTime ? new Date(file.createdTime) : new Date(),
      metadata: {
        modifiedTime: file.modifiedTime,
        context: {
          courseId: file.appProperties?.courseId,
          assignmentId: file.appProperties?.assignmentId,
          userId: file.appProperties?.userId,
        },
      },
    }));
  }

  private buildAppProperties(input: {
    originalName: string;
    sha256?: string;
    size?: number;
    context?: UploadContext;
  }): Record<string, string> {
    const output: Record<string, string> = {
      originalName: input.originalName,
    };

    if (input.sha256) {
      output.sha256 = input.sha256;
    }

    if (typeof input.size === 'number') {
      output.size = String(input.size);
    }

    if (input.context?.courseId) {
      output.courseId = sanitizePathSegment(input.context.courseId, 'courseId');
    }

    if (input.context?.assignmentId) {
      output.assignmentId = sanitizePathSegment(input.context.assignmentId, 'assignmentId');
    }

    if (input.context?.userId) {
      output.userId = sanitizePathSegment(input.context.userId, 'userId');
    }

    return output;
  }

  private async ensureContextFolder(context?: UploadContext): Promise<string> {
    if (!context || (!context.courseId && !context.assignmentId && !context.userId)) {
      return this.rootFolderId;
    }

    const segments: string[] = [];

    if (context.courseId) {
      segments.push('courses', sanitizePathSegment(context.courseId, 'courseId'));
    }

    if (context.assignmentId) {
      segments.push('assignments', sanitizePathSegment(context.assignmentId, 'assignmentId'));
    }

    if (context.userId) {
      segments.push('users', sanitizePathSegment(context.userId, 'userId'));
    }

    let parentId = this.rootFolderId;
    let currentKey = 'root';

    for (const segment of segments) {
      currentKey = `${currentKey}/${segment}`;
      const cached = this.folderCache.get(currentKey);
      if (cached) {
        parentId = cached;
        continue;
      }

      const folderId = await this.findOrCreateFolder(segment, parentId);
      this.folderCache.set(currentKey, folderId);
      parentId = folderId;
    }

    return parentId;
  }

  private async findOrCreateFolder(name: string, parentId: string): Promise<string> {
    const escapedName = name.replace(/'/g, "\\'");

    const existing = await this.drive.files.list({
      q: `name='${escapedName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id,name)',
      pageSize: 1,
    });

    const existingId = existing.data.files?.[0]?.id;
    if (existingId) {
      return existingId;
    }

    const created = await this.drive.files.create({
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
      },
      fields: 'id',
    });

    const createdId = created.data.id;
    if (!createdId) {
      throw new StorageError('FOLDER_CREATE_FAILED', `Could not create folder ${name}`, 502);
    }

    return createdId;
  }
}

function isNotFound(error: unknown): boolean {
  const maybe = error as { code?: number; status?: number; response?: { status?: number } };
  return maybe.code === 404 || maybe.status === 404 || maybe.response?.status === 404;
}
