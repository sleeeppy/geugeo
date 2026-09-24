import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const VERSION = 'v1';

export function deriveKey(master: Buffer, label: string): Buffer {
  return Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), Buffer.from(label, 'utf8'), 32));
}

export function tokenKey(master: Buffer): Buffer {
  return deriveKey(master, 'token-enc');
}

export function registryKey(master: Buffer): Buffer {
  return deriveKey(master, 'registry-db');
}

export function userDbKey(master: Buffer, userId: string): Buffer {
  return deriveKey(master, `user-db:${userId}`);
}

export function encryptSecret(key: Buffer, plaintext: string, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

export function decryptSecret(key: Buffer, encoded: string, aad: string): string {
  const parts = encoded.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('암호문 형식이 올바르지 않아요.');
  }
  const iv = Buffer.from(parts[1] ?? '', 'base64');
  const tag = Buffer.from(parts[2] ?? '', 'base64');
  const ciphertext = Buffer.from(parts[3] ?? '', 'base64');
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
    throw new Error('암호문이 손상됐어요.');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function randomMasterKey(): Buffer {
  return randomBytes(32);
}
