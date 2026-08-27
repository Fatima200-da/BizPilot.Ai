import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';

/**
 * Phase 32 Track B: real AES-256-GCM encryption for backup artifacts at
 * rest — Node's built-in `crypto`, no new runtime dependency, no
 * fabricated/no-op "encryption". GCM is authenticated: decryption fails
 * loudly (not silently, not with corrupted-but-accepted plaintext) if the
 * ciphertext, IV, or auth tag were tampered with or truncated — the same
 * class of real integrity guarantee `verifyBackupIntegrity`'s checksum
 * already gives against accidental corruption, extended here to cover
 * deliberate tampering too.
 *
 * On-disk format for an encrypted file: [12-byte IV][16-byte auth tag][ciphertext].
 * Self-contained — no external metadata needed to decrypt, only the key.
 */

const IV_LENGTH = 12; // GCM's recommended/standard nonce length
const AUTH_TAG_LENGTH = 16;
const ALGORITHM = 'aes-256-gcm';

export function decodeEncryptionKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) {
    throw new Error(`Encryption key must decode to exactly 32 bytes (AES-256); got ${String(key.length)}.`);
  }
  return key;
}

/** Encrypts `inputPath` in place-equivalent: writes ciphertext to `outputPath`, then deletes `inputPath`. */
export async function encryptFile(inputPath: string, outputPath: string, key: Buffer): Promise<void> {
  const plaintext = await readFile(inputPath);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  await writeFile(outputPath, Buffer.concat([iv, authTag, ciphertext]));
  if (outputPath !== inputPath) await unlink(inputPath);
}

/** Decrypts a file written by `encryptFile` and returns the real plaintext bytes — throws (never silently returns garbage) if the auth tag doesn't verify. */
export async function decryptFileToBuffer(inputPath: string, key: Buffer): Promise<Buffer> {
  const data = await readFile(inputPath);
  if (data.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error(`Encrypted file too short to contain a valid IV+authTag: ${inputPath}`);
  }
  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]); // throws on auth-tag mismatch — real tamper detection, not silent
}
