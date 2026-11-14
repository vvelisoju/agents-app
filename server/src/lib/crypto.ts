// SEC-1 — AES-256-GCM encryption for secrets at rest (channel tokens today;
// connected-account credentials in Phase 3). The ciphertext is prefixed with a keyId
// (`k1:…`) so keys can be rotated: decrypt picks the key by its id, new writes use the
// current key. Format: <keyId>:<ivB64>:<tagB64>:<ctB64>.
import crypto from 'node:crypto';

const ALG = 'aes-256-gcm';
const CURRENT_KEY_ID = 'k1';

/** Resolve a 32-byte key for a keyId. Primary key = ENCRYPTION_KEY; older keys may be
 *  provided as ENCRYPTION_KEY_<id> for rotation. Dev/test uses a deterministic key. */
function keyFor(keyId: string): Buffer {
  const envName = keyId === CURRENT_KEY_ID ? 'ENCRYPTION_KEY' : `ENCRYPTION_KEY_${keyId}`;
  const raw = process.env[envName] || (keyId === CURRENT_KEY_ID ? undefined : process.env.ENCRYPTION_KEY);
  if (!raw) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`${envName} is not set — required to encrypt/decrypt secrets at rest in production.`);
    }
    return crypto.createHash('sha256').update('dev-encryption-key').digest(); // dev/test only
  }
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  const b64 = Buffer.from(raw, 'base64');
  if (b64.length === 32) return b64;
  return crypto.createHash('sha256').update(raw).digest(); // derive 32 bytes from any passphrase
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALG, keyFor(CURRENT_KEY_ID), iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [CURRENT_KEY_ID, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

export function decryptSecret(blob: string): string {
  const [keyId, ivB, tagB, ctB] = String(blob).split(':');
  if (!keyId || !ivB || !tagB || ctB === undefined) throw new Error('malformed ciphertext');
  const decipher = crypto.createDecipheriv(ALG, keyFor(keyId), Buffer.from(ivB, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64')), decipher.final()]).toString('utf8');
}

/** True if a stored value is one of our ciphertext blobs (vs a legacy plaintext secret). */
export function isEncrypted(v: unknown): v is string {
  return typeof v === 'string' && /^k\d+:[^:]+:[^:]+:/.test(v);
}

/** Decrypt if encrypted, otherwise return as-is (handles legacy plaintext during migration). */
export function decryptMaybe(v: string | null | undefined): string {
  if (!v) return '';
  return isEncrypted(v) ? decryptSecret(v) : String(v);
}
