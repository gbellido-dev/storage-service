import path from 'node:path';
import { randomUUID } from 'node:crypto';

const SEGMENT_REGEX = /^[a-zA-Z0-9_-]{1,100}$/;
const EXTENSION_REGEX = /^\.[a-zA-Z0-9]{1,10}$/;

export function sanitizePathSegment(segment: string, segmentName: string): string {
  const cleaned = segment.trim();
  if (!cleaned || !SEGMENT_REGEX.test(cleaned)) {
    throw new Error(`Invalid ${segmentName}: only letters, numbers, _ and - are allowed`);
  }
  return cleaned;
}

export function safeExtension(originalName: string): string {
  const ext = path.extname(originalName || '').toLowerCase();
  if (!ext) {
    return '';
  }
  if (!EXTENSION_REGEX.test(ext)) {
    return '';
  }
  return ext;
}

export function buildInternalFilename(originalName: string): string {
  return `${randomUUID()}${safeExtension(originalName)}`;
}
