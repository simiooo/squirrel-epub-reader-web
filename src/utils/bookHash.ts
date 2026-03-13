import type { BookMetadata } from '../types';

export async function generateFileHash(file: Blob): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function generateBookId(file: Blob, metadata: BookMetadata): Promise<string> {
  const contentHash = await generateFileHash(file);
  const metaString = `${metadata.title}|${metadata.author}|${metadata.identifier || ''}`;
  const encoder = new TextEncoder();
  const metaBuffer = encoder.encode(metaString);
  const metaHashBuffer = await crypto.subtle.digest('SHA-256', metaBuffer);
  const metaHashArray = Array.from(new Uint8Array(metaHashBuffer));
  const metaHash = metaHashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return `${contentHash.substring(0, 16)}-${metaHash.substring(0, 16)}`;
}

export async function generateChecksum(file: Blob): Promise<string> {
  return generateFileHash(file);
}

export async function verifyChecksum(file: Blob, checksum: string): Promise<boolean> {
  const computedChecksum = await generateChecksum(file);
  return computedChecksum === checksum;
}

export async function generateQuickHash(file: Blob, sampleSize: number = 65536): Promise<string> {
  if (file.size <= sampleSize * 2) {
    return generateFileHash(file);
  }
  
  const header = file.slice(0, sampleSize);
  const footer = file.slice(file.size - sampleSize, file.size);
  const combined = new Blob([header, footer]);
  
  return generateFileHash(combined);
}