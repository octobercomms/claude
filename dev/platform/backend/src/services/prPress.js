/**
 * Press-release authoring + sign-off. Claude drafts a publication-ready release
 * from a brief; a token-gated link lets the client approve without logging in.
 */
const crypto = require('crypto');
const db = require('../db');
let claude;
try { claude = require('./claude'); } catch (e) { claude = null; }

/** Claude drafts the release body as clean HTML from the brief. Returns { body_html } or { error }. */
async function draftBody({ title, client, angle, key_facts }) {
  if (!claude || !claude.callClaude) return { error: 'Claude not configured.' };
  const system = 'You are an experienced PR writer producing publication-ready press releases. British English. Inverted-pyramid structure: strong headline, optional subhead, a dateline opening paragraph with the core news, supporting paragraphs, a quote (attributed plausibly to a spokesperson — use a clearly-placeholder name like "[Spokesperson Name, Title]" if none is given), and a short boilerplate "About" paragraph. Return clean HTML using only <h1>, <h2>, <p>, <strong>, <em> tags. No markdown, no commentary outside the release.';
  let prompt = `Write a press release.\nHeadline / working title: ${title}\n`;
  if (client) prompt += `Client / organisation: ${client}\n`;
  if (angle) prompt += `Angle / what makes it newsworthy: ${angle}\n`;
  if (key_facts) prompt += `Key facts to include:\n${key_facts}\n`;
  prompt += '\nReturn only the press release as clean HTML. Mark anything you had to assume with square brackets so the team can fill it in.';
  try {
    const text = await claude.callClaude({ max_tokens: 1800, system, user: prompt });
    const body = String(text || '').replace(/^```html?\s*/i, '').replace(/```\s*$/, '').trim();
    return { body_html: body };
  } catch (e) { return { error: e.message }; }
}

/** Guarantee a review token (created lazily when a release first goes to review). */
async function ensureReviewToken(prId) {
  const found = (await db.query('SELECT review_token FROM pr_press_releases WHERE id = $1', [prId])).rows[0];
  if (found && found.review_token) return found.review_token;
  const token = crypto.randomBytes(16).toString('hex');
  await db.query('UPDATE pr_press_releases SET review_token = $1 WHERE id = $2', [token, prId]);
  return token;
}

/** Public: fetch a release for the approval page by its review token. */
async function getByReviewToken(token) {
  const r = (await db.query(
    `SELECT p.id, p.title, p.body_html, p.status, p.approved_at, p.approved_by, cl.name AS client_name
     FROM pr_press_releases p JOIN clients cl ON cl.id = p.client_id
     WHERE p.review_token = $1`, [token]
  )).rows[0];
  return r || null;
}

/** Public: record client sign-off (the token is the authorisation). */
async function approveByToken(token, approver) {
  const r = (await db.query('SELECT id, status FROM pr_press_releases WHERE review_token = $1', [token])).rows[0];
  if (!r) return null;
  if (r.status === 'approved' || r.status === 'sent') return getByReviewToken(token);
  await db.query(
    "UPDATE pr_press_releases SET status = 'approved', approved_at = NOW(), approved_by = $1 WHERE id = $2",
    [String(approver || 'Client').slice(0, 200), r.id]
  );
  return getByReviewToken(token);
}

module.exports = { draftBody, ensureReviewToken, getByReviewToken, approveByToken };
