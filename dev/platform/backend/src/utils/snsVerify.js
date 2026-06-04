// AWS SNS signature verification + SubscribeURL allowlist for the
// SES bounce/complaint webhook. Implemented manually rather than via
// the sns-validator npm package so we don't add a runtime dependency
// for one webhook.
//
// SNS signs Notification and *Confirmation messages by:
//   1. Building a canonical newline-separated string of specific fields
//      in a fixed order (different fields per message type).
//   2. SHA1/SHA256 over that string, signed RSA with the cert at
//      SigningCertURL.
// The verifier:
//   - Fetches + caches the cert (must be hosted on sns.<region>.amazonaws.com)
//   - Reconstructs the canonical string
//   - Verifies the Signature against the cert's public key
//
// Reference: https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html

const crypto = require('crypto');
const https = require('https');

// Cert cache — same SigningCertURL is reused for tens of thousands of
// messages, so caching keeps verify() at sub-millisecond per message.
const certCache = new Map();
const CERT_CACHE_TTL_MS = 60 * 60 * 1000; // 1h

// AWS hosts SNS certs on sns.<region>.amazonaws.com — anything else is
// an attacker-supplied URL trying to get us to verify against a key
// they control. This regex matches the published pattern.
const TRUSTED_CERT_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com$/i;

// Subscription / Unsubscription Confirmation URLs use the same host
// pattern. We refuse to fetch anything else — defence against a forged
// SubscriptionConfirmation that points SubscribeURL at an internal
// service for SSRF.
const TRUSTED_SUBSCRIBE_HOST_RE = /^sns\.[a-z0-9-]+\.amazonaws\.com$/i;

function isTrustedSnsUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    if (u.protocol !== 'https:') return false;
    return TRUSTED_SUBSCRIBE_HOST_RE.test(u.hostname);
  } catch { return false; }
}

async function fetchCert(certUrl) {
  const cached = certCache.get(certUrl);
  if (cached && Date.now() - cached.at < CERT_CACHE_TTL_MS) return cached.pem;
  const u = new URL(certUrl);
  if (u.protocol !== 'https:' || !TRUSTED_CERT_HOST.test(u.hostname)) {
    throw new Error(`Refusing SNS cert from untrusted host: ${u.hostname}`);
  }
  const pem = await new Promise((resolve, reject) => {
    const req = https.get(certUrl, { timeout: 5000 }, res => {
      if (res.statusCode !== 200) return reject(new Error(`Cert fetch failed: HTTP ${res.statusCode}`));
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Cert fetch timeout')); });
  });
  certCache.set(certUrl, { pem, at: Date.now() });
  return pem;
}

// Canonical string fields per SNS spec. Order is fixed.
const FIELDS_BY_TYPE = {
  Notification: ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'],
  SubscriptionConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
  UnsubscribeConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
};

function buildStringToSign(body) {
  const fields = FIELDS_BY_TYPE[body.Type];
  if (!fields) throw new Error(`Unknown SNS message Type: ${body.Type}`);
  const parts = [];
  for (const f of fields) {
    if (f === 'Subject' && body[f] == null) continue; // Subject is optional
    if (body[f] == null) throw new Error(`Missing required SNS field: ${f}`);
    parts.push(f, body[f]);
  }
  return parts.join('\n') + '\n';
}

// Verify the SNS message signature. Throws on any mismatch — caller
// should treat any thrown error as "reject this message".
async function verifySnsMessage(body) {
  if (!body || typeof body !== 'object') throw new Error('SNS body missing');
  if (!body.SigningCertURL || !body.Signature) throw new Error('SNS signature fields missing');
  const pem = await fetchCert(body.SigningCertURL);
  const stringToSign = buildStringToSign(body);
  const algo = body.SignatureVersion === '2' ? 'RSA-SHA256' : 'RSA-SHA1';
  const verifier = crypto.createVerify(algo);
  verifier.update(stringToSign, 'utf8');
  const ok = verifier.verify(pem, body.Signature, 'base64');
  if (!ok) throw new Error('SNS signature did not verify');
  return true;
}

module.exports = { verifySnsMessage, isTrustedSnsUrl };
