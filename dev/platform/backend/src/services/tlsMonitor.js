// Daily TLS-certificate expiry watch. Opens a TLS connection to each watched
// domain and reads the *served* certificate's expiry — so it catches a lapse no
// matter the cause (renewal timer dead, authenticator clash, IPv6 challenge
// failing, DNS moved). Emails ALERT_EMAIL when any cert is within the alert
// window or the host is unreachable. Wired into the cron scheduler.
//
// Why check the live handshake rather than the local /etc/letsencrypt files:
// it sees exactly what a browser sees (including a stale cert nginx never
// reloaded), needs no filesystem/permission access, and works even if the box
// moves. rejectUnauthorized is off on purpose — we're reading the expiry date
// of our own domains, not authenticating them, so an already-expired cert still
// yields its dates instead of aborting the handshake.

const tls = require('tls');

const DEFAULT_ALERT_DAYS = 14;

// Watched hostnames: TLS_MONITOR_DOMAINS (comma/space separated) if set,
// otherwise the PLATFORM_URL host so the platform's own cert is always watched.
function hostsFromEnv() {
  const raw = (process.env.TLS_MONITOR_DOMAINS || '')
    .split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
  if (raw.length) return Array.from(new Set(raw));
  try {
    const u = new URL(process.env.PLATFORM_URL || '');
    if (u.hostname) return [u.hostname];
  } catch { /* PLATFORM_URL unset or malformed */ }
  return [];
}

// Resolve one host's served-cert expiry. Never rejects — failures resolve to
// { ok: false, error }, so one dead host can't sink the batch.
function checkHost(host, { port = 443, timeoutMs = 10000 } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (r) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* already gone */ }
      resolve({ host, ...r });
    };
    const socket = tls.connect(
      { host, port, servername: host, timeout: timeoutMs, rejectUnauthorized: false },
      () => {
        const cert = socket.getPeerCertificate();
        if (!cert || !cert.valid_to) return finish({ ok: false, error: 'no certificate presented' });
        const validTo = new Date(cert.valid_to);
        if (isNaN(validTo.getTime())) return finish({ ok: false, error: `unparseable expiry "${cert.valid_to}"` });
        const daysLeft = Math.floor((validTo.getTime() - Date.now()) / 86400000);
        finish({ ok: true, validTo, daysLeft });
      }
    );
    socket.on('timeout', () => finish({ ok: false, error: 'connection timed out' }));
    socket.on('error', (err) => finish({ ok: false, error: err.message }));
  });
}

async function check(hosts = hostsFromEnv()) {
  return Promise.all(hosts.map(h => checkHost(h)));
}

// Daily run. Emails ALERT_EMAIL if any watched cert is unreachable or within the
// alert window (TLS_ALERT_DAYS, default 14). Silent when everything's healthy.
async function runCheck() {
  const hosts = hostsFromEnv();
  if (!hosts.length) return { checked: 0, alerts: 0, results: [] };
  const alertDays = parseInt(process.env.TLS_ALERT_DAYS, 10) || DEFAULT_ALERT_DAYS;
  const results = await check(hosts);
  const problems = results.filter(r => !r.ok || (typeof r.daysLeft === 'number' && r.daysLeft <= alertDays));
  if (problems.length) {
    try {
      await require('./emailService').sendCertExpiryAlert({ problems, alertDays });
    } catch (e) {
      console.error('[tlsMonitor] alert email failed:', e.message);
    }
    console.warn('[tlsMonitor] cert issues:', problems.map(p => p.ok ? `${p.host} ${p.daysLeft}d` : `${p.host} ${p.error}`).join('; '));
  }
  return { checked: results.length, alerts: problems.length, results };
}

module.exports = { check, checkHost, runCheck, hostsFromEnv };
