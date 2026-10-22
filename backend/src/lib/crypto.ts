import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // Recommended for GCM
const KEY_LENGTH = 32; // 256 bits

// Key versioning (audit B6 / L9).
//
// Output format: `v<N>:<base64 iv>:<base64 authTag>:<base64 ciphertext>`,
// where N is ENCRYPTION_KEY_VERSION (default 1) — the version of
// ENCRYPTION_KEY. Legacy payloads written before versioning have no prefix
// (`iv:tag:ct`) and are decrypted with ENCRYPTION_KEY, then
// ENCRYPTION_KEY_PREVIOUS.
//
// Rotation: set ENCRYPTION_KEY_PREVIOUS to the old key, ENCRYPTION_KEY to the
// new key and bump ENCRYPTION_KEY_VERSION. Payloads tagged with the current
// version use ENCRYPTION_KEY; any other version uses ENCRYPTION_KEY_PREVIOUS.
// Rows are re-encrypted with the new key on their next write.

function decodeKey(raw: string, name: string): Buffer {
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `${name} must decode to ${KEY_LENGTH} bytes (got ${key.length}). ` +
        'Generate a new one with: openssl rand -base64 32'
    );
  }
  return key;
}

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'ENCRYPTION_KEY environment variable is not set. ' +
        'Generate one with: openssl rand -base64 32'
    );
  }
  return decodeKey(raw, 'ENCRYPTION_KEY');
}

function getPreviousKey(): Buffer | null {
  const raw = process.env.ENCRYPTION_KEY_PREVIOUS;
  return raw ? decodeKey(raw, 'ENCRYPTION_KEY_PREVIOUS') : null;
}

function currentVersion(): string {
  const raw = (process.env.ENCRYPTION_KEY_VERSION ?? '1').trim();
  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw new Error(`ENCRYPTION_KEY_VERSION must be a positive integer (got "${raw}")`);
  }
  return `v${raw}`;
}

/**
 * Encrypts a plaintext string with AES-256-GCM under the current key version.
 */
export function encrypt(plaintext: string): string {
  const version = currentVersion();
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    version,
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

function decryptWithKey(key: Buffer, ivB64: string, tagB64: string, dataB64: string): string {
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(dataB64, 'base64');

  if (iv.length !== IV_LENGTH) {
    throw new Error(`Invalid IV length: expected ${IV_LENGTH}, got ${iv.length}`);
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return plaintext.toString('utf8');
}

/**
 * Decrypts a payload produced by `encrypt()` (versioned) or by the
 * pre-versioning format.
 *
 * Throws if the payload is malformed, no key matches, or auth fails.
 */
export function decrypt(payload: string): string {
  const parts = payload.split(':');

  if (parts.length === 4 && /^v[1-9][0-9]*$/.test(parts[0])) {
    const [version, ivB64, tagB64, dataB64] = parts;
    let key: Buffer | null;
    if (version === currentVersion()) {
      key = getKey();
    } else {
      key = getPreviousKey();
    }
    if (!key) {
      throw new Error(`No key configured for version ${version}`);
    }
    return decryptWithKey(key, ivB64, tagB64, dataB64);
  }

  if (parts.length === 3) {
    const [ivB64, tagB64, dataB64] = parts;
    const key = getKey();
    try {
      return decryptWithKey(key, ivB64, tagB64, dataB64);
    } catch (err) {
      const previous = getPreviousKey();
      if (!previous) throw err;
      return decryptWithKey(previous, ivB64, tagB64, dataB64);
    }
  }

  throw new Error('Invalid encrypted payload format');
}
