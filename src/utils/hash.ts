import { createHash } from 'node:crypto';
import { Transform } from 'node:stream';

export class HashAndSizeTransform extends Transform {
  private readonly hash = createHash('sha256');
  private bytes = 0;

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.bytes += chunk.length;
    this.hash.update(chunk);
    this.push(chunk);
    callback();
  }

  public digestHex(): string {
    return this.hash.digest('hex');
  }

  public get size(): number {
    return this.bytes;
  }
}
