import path from 'node:path';
import { createReadStream, createWriteStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import type { Readable } from 'node:stream';

import type { StorageProvider } from '../StorageProvider.js';
import type {
  StorageProviderName,
  StoredFile,
  StoredFileSidecar,
  UploadContext,
  UploadInput,
} from '../../types/storage.types.js';
import { buildInternalFilename, sanitizePathSegment } from '../../utils/filenames.js';
import { HashAndSizeTransform } from '../../utils/hash.js';
import { pipelineSafe } from '../../utils/streams.js';
import { FileNotFoundError, InvalidStorageIdError } from '../../errors/StorageError.js';

interface FilesystemStorageProviderOptions {
  basePath: string;
  providerName: StorageProviderName;
}

export abstract class FilesystemStorageProvider implements StorageProvider {
  protected readonly basePath: string;
  protected readonly providerName: StorageProviderName;

  protected constructor(options: FilesystemStorageProviderOptions) {
    this.basePath = path.resolve(options.basePath);
    this.providerName = options.providerName;
  }

  public async upload(input: UploadInput): Promise<StoredFile> {
    const relativeDir = buildLogicalDirectory(input.context);
    const filename = buildInternalFilename(input.originalName);
    const storageId = path.posix.join(relativeDir, filename);

    const absoluteFilePath = this.resolveStoragePath(storageId);
    await fs.mkdir(path.dirname(absoluteFilePath), { recursive: true });

    const hashAndSize = new HashAndSizeTransform();
    const targetStream = createWriteStream(absoluteFilePath, { flags: 'wx' });

    try {
      await pipelineSafe(input.stream, hashAndSize, targetStream);
      const storedFile: StoredFile = {
        provider: this.providerName,
        storageId,
        originalName: input.originalName,
        mimeType: input.mimeType,
        size: hashAndSize.size,
        sha256: hashAndSize.digestHex(),
        createdAt: new Date(),
      };

      await this.writeSidecar(storageId, {
        originalName: storedFile.originalName,
        mimeType: storedFile.mimeType,
        size: storedFile.size,
        sha256: storedFile.sha256,
        createdAt: storedFile.createdAt.toISOString(),
        context: input.context,
      });

      return storedFile;
    } catch (error) {
      await fs.rm(absoluteFilePath, { force: true });
      throw error;
    }
  }

  public async download(storageId: string): Promise<Readable> {
    const filePath = this.resolveStoragePath(storageId);
    if (!(await this.exists(storageId))) {
      throw new FileNotFoundError();
    }
    return createReadStream(filePath);
  }

  public async delete(storageId: string): Promise<void> {
    const filePath = this.resolveStoragePath(storageId);
    const metadataPath = this.metadataFilePath(storageId);

    if (!(await this.exists(storageId))) {
      throw new FileNotFoundError();
    }

    await fs.rm(filePath, { force: true });
    await fs.rm(metadataPath, { force: true });
  }

  public async exists(storageId: string): Promise<boolean> {
    try {
      const filePath = this.resolveStoragePath(storageId);
      const stat = await fs.stat(filePath);
      return stat.isFile();
    } catch {
      return false;
    }
  }

  public async getMetadata(storageId: string): Promise<StoredFile> {
    if (!(await this.exists(storageId))) {
      throw new FileNotFoundError();
    }

    const sidecar = await this.readSidecar(storageId);
    if (!sidecar) {
      const stat = await fs.stat(this.resolveStoragePath(storageId));
      return {
        provider: this.providerName,
        storageId,
        originalName: path.basename(storageId),
        size: stat.size,
        sha256: '',
        createdAt: stat.birthtime,
      };
    }

    return {
      provider: this.providerName,
      storageId,
      originalName: sidecar.originalName,
      mimeType: sidecar.mimeType,
      size: sidecar.size,
      sha256: sidecar.sha256,
      createdAt: new Date(sidecar.createdAt),
      metadata: {
        context: sidecar.context,
      },
    };
  }

  public async list(prefix?: string): Promise<StoredFile[]> {
    const root = prefix ? this.resolveStoragePath(prefix) : this.basePath;

    if (!(await pathExists(root))) {
      return [];
    }

    const files = await this.walkFiles(root);
    const records: StoredFile[] = [];

    for (const fullPath of files) {
      if (fullPath.endsWith('.metadata.json')) {
        continue;
      }
      const relative = path.relative(this.basePath, fullPath).split(path.sep).join(path.posix.sep);
      const stat = await fs.stat(fullPath);
      const sidecar = await this.readSidecar(relative);
      records.push({
        provider: this.providerName,
        storageId: relative,
        originalName: sidecar?.originalName ?? path.basename(relative),
        mimeType: sidecar?.mimeType,
        size: sidecar?.size ?? stat.size,
        sha256: sidecar?.sha256 ?? '',
        createdAt: sidecar ? new Date(sidecar.createdAt) : stat.birthtime,
        metadata: sidecar?.context ? { context: sidecar.context } : undefined,
      });
    }

    return records.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  protected resolveStoragePath(storageId: string): string {
    validateStorageId(storageId);

    const normalized = path.posix.normalize(storageId);
    if (normalized.startsWith('../') || normalized.includes('/../') || normalized === '..') {
      throw new InvalidStorageIdError('Path traversal attempt detected');
    }

    const fullPath = path.resolve(this.basePath, normalized);
    const relative = path.relative(this.basePath, fullPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new InvalidStorageIdError('Storage path escaped base directory');
    }

    return fullPath;
  }

  protected metadataFilePath(storageId: string): string {
    return `${this.resolveStoragePath(storageId)}.metadata.json`;
  }

  private async writeSidecar(storageId: string, sidecar: StoredFileSidecar): Promise<void> {
    const metadataPath = this.metadataFilePath(storageId);
    await fs.writeFile(metadataPath, `${JSON.stringify(sidecar, null, 2)}\n`, 'utf-8');
  }

  private async readSidecar(storageId: string): Promise<StoredFileSidecar | null> {
    try {
      const metadataPath = this.metadataFilePath(storageId);
      const data = await fs.readFile(metadataPath, 'utf-8');
      const parsed = JSON.parse(data) as StoredFileSidecar;
      return parsed;
    } catch {
      return null;
    }
  }

  private async walkFiles(directory: string): Promise<string[]> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const output: string[] = [];

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        output.push(...(await this.walkFiles(fullPath)));
      } else if (entry.isFile()) {
        output.push(fullPath);
      }
    }

    return output;
  }
}

function validateStorageId(storageId: string): void {
  if (!storageId || typeof storageId !== 'string') {
    throw new InvalidStorageIdError('Storage id must be a non-empty string');
  }

  if (storageId.includes('\\') || storageId.includes('\0')) {
    throw new InvalidStorageIdError('Storage id contains invalid characters');
  }
}

function buildLogicalDirectory(context?: UploadContext): string {
  if (!context || (!context.courseId && !context.assignmentId && !context.userId)) {
    return 'files';
  }

  const parts: string[] = [];

  if (context.courseId) {
    parts.push('courses', sanitizePathSegment(context.courseId, 'courseId'));
  }

  if (context.assignmentId) {
    parts.push('assignments', sanitizePathSegment(context.assignmentId, 'assignmentId'));
  }

  if (context.userId) {
    parts.push('users', sanitizePathSegment(context.userId, 'userId'));
  }

  return parts.join('/');
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
