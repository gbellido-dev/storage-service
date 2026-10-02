import { describe, it, expect, beforeEach } from 'vitest';
import { Readable } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { LocalStorageProvider } from './LocalStorageProvider.js';

describe('LocalStorageProvider', () => {
  let basePath: string;

  beforeEach(() => {
    basePath = mkdtempSync(path.join(tmpdir(), 'storage-service-test-'));
  });

  function sha256(input: string): string {
    return createHash('sha256').update(input).digest('hex');
  }

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
    expect(metadata.sha256).toBe(sha256(content));
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

  it('stores duplicated original names with different storage ids', async () => {
    const storage = new LocalStorageProvider({ basePath });

    const first = await storage.upload({
      stream: Readable.from('a'),
      originalName: 'same-name.pdf',
      mimeType: 'application/pdf',
    });

    const second = await storage.upload({
      stream: Readable.from('b'),
      originalName: 'same-name.pdf',
      mimeType: 'application/pdf',
    });

    expect(first.storageId).not.toBe(second.storageId);
    expect(await storage.exists(first.storageId)).toBe(true);
    expect(await storage.exists(second.storageId)).toBe(true);

    rmSync(basePath, { recursive: true, force: true });
  });

  it('keeps original names with special characters while using UUID physical names', async () => {
    const storage = new LocalStorageProvider({ basePath });

    const result = await storage.upload({
      stream: Readable.from('binary-data'),
      originalName: 'Mi practica final 2026 (version 2).pdf',
      mimeType: 'application/pdf',
    });

    const metadata = await storage.getMetadata(result.storageId);

    expect(metadata.originalName).toBe('Mi practica final 2026 (version 2).pdf');
    expect(result.storageId.startsWith('files/')).toBe(true);
    expect(result.storageId.endsWith('.pdf')).toBe(true);

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

    await expect(storage.getMetadata('../../evil')).rejects.toThrow();

    rmSync(basePath, { recursive: true, force: true });
  });
});
