import { describe, expect, it } from 'vitest';
import { decryptSecret, deriveKey, encryptSecret, randomMasterKey } from '../src/security/crypto.js';

describe('crypto', () => {
  it('encrypts and decrypts with the same key and user id', () => {
    const key = deriveKey(randomMasterKey(), 'token-enc');
    const encoded = encryptSecret(key, 'user-token-value', '123');
    expect(decryptSecret(key, encoded, '123')).toBe('user-token-value');
  });

  it('rejects a tampered ciphertext', () => {
    const key = deriveKey(randomMasterKey(), 'token-enc');
    const encoded = encryptSecret(key, 'secret', '123');
    const parts = encoded.split(':');
    const cipher = Buffer.from(parts[3] ?? '', 'base64');
    cipher[0] = (cipher[0] ?? 0) ^ 0xff;
    parts[3] = cipher.toString('base64');
    expect(() => decryptSecret(key, parts.join(':'), '123')).toThrow();
  });

  it('rejects a ciphertext moved to another user id', () => {
    const key = deriveKey(randomMasterKey(), 'token-enc');
    const encoded = encryptSecret(key, 'secret', '111');
    expect(() => decryptSecret(key, encoded, '222')).toThrow();
  });

  it('derives different keys for different labels', () => {
    const master = randomMasterKey();
    const a = deriveKey(master, 'registry-db');
    const b = deriveKey(master, 'user-db:1');
    expect(Buffer.compare(a, b)).not.toBe(0);
    expect(a).toHaveLength(32);
  });
});
