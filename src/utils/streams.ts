import { pipeline } from 'node:stream/promises';
import type { Readable, Writable } from 'node:stream';

export async function pipelineSafe(source: Readable, ...destinations: Writable[]): Promise<void> {
  await pipeline([source, ...destinations]);
}
