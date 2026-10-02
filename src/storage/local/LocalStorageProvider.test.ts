import { describe, it, expect, beforeEach } from 'vitest';
import { Readable } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { LocalStorageProvider } from './LocalStorageProvider.js';

describe('LocalStorageProvider', () => {
  let basePath: string;

  beforeEach(() => {
    basePath = mkdtempSync(path.join(tmpdir(), 'storage-service-test-'));
  });

  it('uploads a file, computes sha256 and allows download', async () => {
    const storage = new LocalStorageProvider({ basePath });
    const content = 'hello world\n';

    const result = await storage.upload({
      stream: Readable.from(content),
      originalName: 'report.txt',
      mimeType: 'text/plain',
      context: {
        courseId: 'asir2',
        assignmentId: '23',
        userId: '154',
      },
    });

    expect(result.provider).toBe('local');
    expect(result.originalName).toBe('report.txt');
    expect(result.mimeType).toBe('text/plain');
    expect(result.size).toBe(Buffer.byteLength(content));
    expect(await storage.exists(result.storageId)).toBe(true);

    const metadata = await storage.getMetadata(result.storageId);
    expect(metadata.sha256).toBeDefined();
    expect(metadata.sha256.length).toBe(64);

    const chunks: Buffer[] = [];
    for await (const chunk of await storage.download(result.storageId)) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    expect(Buffer.concat(chunks).toString()).toBe(content);

    await storage.delete(result.storageId);
    expect(await storage.exists(result.storageId)).toBe(false);

    rmSync(basePath, { recursive: true, force: true });
  });

  it('rejects path traversal attempts in logical context paths', async () => {
    const storage = new LocalStorageProvider({ basePath });

    await expect(
      storage.upload({
        stream: Readable.from('boom'),
        originalName: 'file.txt',
        context: {
          courseId: '../../etc',
          assignmentId: '23',
          userId: '154',
        },
      }),
    ).rejects.toThrow();
  });
});
