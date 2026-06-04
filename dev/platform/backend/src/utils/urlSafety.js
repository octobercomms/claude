// Outbound-URL safety helpers. Used to gate server-side HTTP fetches
// (press release parse, image proxies, etc.) so a request from an
// authenticated AM can't be aimed at internal services, the AWS instance
// metadata endpoint, or other infrastructure the user shouldn't be able
// to reach via the platform.
//
// Two-layer check:
//   1. Hostname pattern check (rejects literal localhost / loopback /
//      private + link-local IP ranges in the URL).
//   2. DNS resolution check (resolves the host and ensures every A/AAAA
//      record is a public address). Catches a public hostname that
//      resolves to 169.254.169.254 / 10.x via attacker DNS.
//
// Both layers are needed: layer 1 catches direct IP / `localhost` URLs
// without a DNS round-trip; layer 2 catches DNS rebinding and CNAME
// tricks where a public-looking host points internally.

const dns = require('dns').promises;
const net = require('net');

// Hostname rejects: localhost variants + literal IPs we know are private.
// Match before DNS so we don't waste a lookup on obvious abuse.
const HOSTNAME_DENYLIST = [
  /^localhost$/i,
  /^localhost\./i,
  /\.local$/i,
  /\.internal$/i,
];

// Allow override for tests / dev where developers point at localhost.
function devOverrideEnabled() {
  return process.env.URL_SAFETY_ALLOW_PRIVATE === '1';
}

function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => Number.isNaN(n) || n < 0 || n > 255)) return true; // malformed → reject
  const [a, b] = parts;
  if (a === 10) return true;                         // 10.0.0.0/8
  if (a === 127) return true;                        // 127.0.0.0/8 loopback
  if (a === 0) return true;                          // 0.0.0.0/8
  if (a === 169 && b === 254) return true;           // 169.254.0.0/16 link-local + AWS metadata
  if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16.0.0/12
  if (a === 192 && b === 168) return true;           // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a >= 224) return true;                         // multicast + reserved
  return false;
}

function isPrivateIPv6(ip) {
  const lower = ip.toLowerCase();
  if (lower === '::1') return true;                  // loopback
  if (lower === '::') return true;                   // unspecified
  if (lower.startsWith('fe80:')) return true;        // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
  if (lower.startsWith('::ffff:')) {
    // IPv4-mapped — extract and re-check
    const ipv4 = lower.split(':').pop();
    if (ipv4 && ipv4.includes('.')) return isPrivateIPv4(ipv4);
  }
  return false;
}

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (net.isIPv6(ip)) return isPrivateIPv6(ip);
  return true; // unrecognised → reject
}

// Throws when the URL points at a host we won't fetch from. Caller
// should let the throw bubble back to the user as a 400.
async function assertPublicHttpUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length > 2048) {
    throw new Error('URL is missing or too long.');
  }
  let u;
  try { u = new URL(rawUrl); }
  catch { throw new Error('URL is malformed.'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Only http(s) URLs are allowed.');
  }
  // Credentials in URL — these can be used to bypass redirect checks
  // on some HTTP clients, and they're never legitimate from the SPA.
  if (u.username || u.password) throw new Error('URL must not contain credentials.');

  const host = u.hostname;
  if (HOSTNAME_DENYLIST.some(rx => rx.test(host))) {
    if (!devOverrideEnabled()) throw new Error(`Refusing to fetch from internal host: ${host}`);
  }
  // If the hostname is a literal IP, check it directly without DNS.
  if (net.isIP(host)) {
    if (isPrivateIp(host) && !devOverrideEnabled()) {
      throw new Error(`Refusing to fetch from private IP: ${host}`);
    }
    return;
  }
  // Resolve and verify every record. node-fetch / axios may pick any
  // of them; if ANY is private, treat the host as untrustworthy.
  let addrs;
  try {
    addrs = await dns.lookup(host, { all: true });
  } catch {
    throw new Error(`DNS lookup failed for ${host}`);
  }
  for (const a of addrs) {
    if (isPrivateIp(a.address) && !devOverrideEnabled()) {
      throw new Error(`Refusing to fetch from ${host} — resolves to private address ${a.address}`);
    }
  }
}

module.exports = { assertPublicHttpUrl, isPrivateIp };
