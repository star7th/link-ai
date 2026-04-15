/**
 * 加密/解密模块单元测试
 *
 * 测试覆盖：
 * - encrypt / decrypt 往返一致性
 * - hashToken 确定性
 * - generateApiKey 格式
 * - 使用 NEXTAUTH_SECRET 派生密钥
 */

import { describe, it, expect, beforeAll } from 'vitest';

// Set environment variable before importing crypto module
beforeAll(() => {
  process.env.NEXTAUTH_SECRET = 'test-secret-for-unit-tests-32chars!!';
});

import { encrypt, decrypt, hashToken, generateApiKey } from '../crypto';

describe('crypto', () => {
  describe('encrypt / decrypt (AES-256-GCM)', () => {
    it('round-trips correctly', () => {
      const plaintext = 'sk-proj-abc123secretkey';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('produces different ciphertexts each time (random IV)', () => {
      const plaintext = 'same-input';
      const enc1 = encrypt(plaintext);
      const enc2 = encrypt(plaintext);
      expect(enc1).not.toBe(enc2);
    });

    it('encrypted format is iv:tag:ciphertext (3 parts)', () => {
      const encrypted = encrypt('test');
      const parts = encrypted.split(':');
      expect(parts).toHaveLength(3);
    });

    it('handles empty string', () => {
      const encrypted = encrypt('');
      expect(decrypt(encrypted)).toBe('');
    });

    it('handles unicode', () => {
      const plaintext = '你好世界 🌍 密钥';
      expect(decrypt(encrypt(plaintext))).toBe(plaintext);
    });

    it('handles very long strings', () => {
      const plaintext = 'a'.repeat(10000);
      expect(decrypt(encrypt(plaintext))).toBe(plaintext);
    });
  });

  describe('hashToken', () => {
    it('produces a deterministic SHA-256 hex hash', () => {
      const hash1 = hashToken('lk-test-key');
      const hash2 = hashToken('lk-test-key');
      expect(hash1).toBe(hash2);
    });

    it('different inputs produce different hashes', () => {
      expect(hashToken('key-a')).not.toBe(hashToken('key-b'));
    });

    it('hash is 64 hex characters (256 bits)', () => {
      expect(hashToken('test')).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('generateApiKey', () => {
    it('starts with "lk-" prefix', () => {
      expect(generateApiKey()).toMatch(/^lk-/);
    });

    it('generates different keys each time', () => {
      expect(generateApiKey()).not.toBe(generateApiKey());
    });

    it('produces base64url-encoded key', () => {
      const key = generateApiKey();
      // Remove "lk-" prefix, rest should be valid base64url
      const payload = key.slice(3);
      expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
    });
  });
});
