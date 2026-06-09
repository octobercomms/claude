// Marketing playbooks loader.
//
// Distilled, prompt-ready marketing methodology fragments live in
// src/data/marketingPlaybooks/*.md. They are condensed from the MIT-licensed
// coreyhaines31/marketingskills skills (the full skills are also installed at
// repo .claude/skills/ for human/editor use; these fragments are the trimmed
// versions safe to inject into a system prompt without blowing the token
// budget). See docs/nvelope/external-integrations-plan.md, Integration 3.
//
// Services append the relevant playbook to their existing system prompt so
// every automated run is grounded in proven methodology. This slice ships the
// loader + the first batch of fragments; wiring into the Claude-backed
// services lands in the next slices.

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data', 'marketingPlaybooks');
const cache = new Map();

// Load a single playbook by name (filename without the .md). Cached after the
// first read. Returns '' when the playbook doesn't exist, so a caller can
// always safely append the result to a prompt without a guard.
function getPlaybook(name) {
  const safe = String(name || '').replace(/[^a-z0-9-]/gi, '');
  if (!safe) return '';
  if (cache.has(safe)) return cache.get(safe);
  let text = '';
  try {
    text = fs.readFileSync(path.join(DIR, `${safe}.md`), 'utf8').trim();
  } catch {
    text = '';
  }
  cache.set(safe, text);
  return text;
}

// Combine several playbooks into one prompt-ready block. Used by services that
// draw on more than one (e.g. content draws on copywriting + content-strategy).
// Missing playbooks are skipped silently.
function getPlaybooks(names = []) {
  const parts = [];
  for (const n of names) {
    const t = getPlaybook(n);
    if (t) parts.push(t);
  }
  return parts.join('\n\n---\n\n');
}

// Convenience: render selected playbooks as a system-prompt suffix, or '' if
// none resolve. Lets a service do `SYSTEM + playbooks.systemSuffix([...])`
// without each one re-implementing the "# Methodology to apply" framing.
function systemSuffix(names = []) {
  const body = getPlaybooks(names);
  return body ? `\n\n# Methodology to apply\n${body}` : '';
}

// Names of every available playbook — handy for diagnostics / a Settings list.
function list() {
  try {
    return fs.readdirSync(DIR)
      .filter(f => f.endsWith('.md') && f.toLowerCase() !== 'readme.md')
      .map(f => f.replace(/\.md$/, ''))
      .sort();
  } catch {
    return [];
  }
}

module.exports = { getPlaybook, getPlaybooks, systemSuffix, list };
