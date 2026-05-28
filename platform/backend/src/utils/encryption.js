const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;

function getKey() {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error('ENCRYPTION_KEY not set');
  // Must be a 64-char hex string (32 bytes). Anything else — wrong length
  // or non-hex characters — would silently truncate via Buffer.from('hex')
  // and leave AES-256 running with an effectively-empty key, which is
  // catastrophic. Fail loudly at first encrypt/decrypt instead.
  if (!/^[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string (32 bytes). Generate one with: openssl rand -hex 32');
  }
  return Buffer.from(key, 'hex');
}

// Boot-time validator — called from index.js once at startup so an
// operator running with a broken key sees the error immediately rather
// than the first time a connector is decrypted.
function assertKeyValid() {
  getKey();   // throws if invalid
}

function encrypt(text) {
  if (!text) return null;
  const key = getKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(text), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString('hex'),
    data: encrypted.toString('hex'),
    tag: authTag.toString('hex'),
  };
}

function decrypt(encryptedObj) {
  if (!encryptedObj || !encryptedObj.data) return null;
  const key = getKey();
  const iv = Buffer.from(encryptedObj.iv, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(Buffer.from(encryptedObj.tag, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedObj.data, 'hex')),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString('utf8'));
}

module.exports = { encrypt, decrypt, assertKeyValid };
