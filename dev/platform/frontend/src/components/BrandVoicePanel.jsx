import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';

// Brand voice profile — sits inside the Brand page. AM pastes 3–10
// URLs of the client's best-performing pages, Claude analyses them and
// returns a structured voice profile (tone, sentence structure,
// vocabulary, do/don't examples). Every future content brief + draft
// automatically picks up the active profile.
export default function BrandVoicePanel({ clientId }) {
  const [profile, setProfile] = useState(null);
  const [history, setHistory] = useState([]);
  const [urlsText, setUrlsText] = useState('');
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => { refresh(); /* eslint-disable-line */ }, [clientId]);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [running]); // eslint-disable-line

  async function refresh() {
    setLoading(true);
    try {
      const r = await api.get(`/seo/clients/${clientId}/brand-voice`);
      setProfile(r.active);
      setHistory(r.history || []);
      setRunning((r.history || []).some(h => h.status === 'running'));
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  async function run() {
    const urls = urlsText.split('\n').map(u => u.trim()).filter(Boolean);
    if (!urls.length) return;
    setErr(null); setRunning(true);
    try {
      await api.post(`/seo/clients/${clientId}/brand-voice`, { urls });
      setUrlsText('');
      setTimeout(refresh, 1500);
    } catch (e) { setErr(e.message); setRunning(false); }
  }

  const urlCount = urlsText.split('\n').map(u => u.trim()).filter(Boolean).length;

  return (
    <div className="mt-6" style={{ borderTop: 'var(--border-w) solid var(--card-border)', paddingTop: 'var(--s6)' }}>
      <div className="caption">Brand voice profile</div>
      <h2 className="h2 mt-2">How this client writes — extracted from real pages</h2>
      <p className="body-sm text-muted mt-2 mb-5" style={{ maxWidth: 760 }}>
        Paste 3–10 URLs of the client's best-performing pages. Claude analyses tone, sentence structure,
        vocabulary, reading level, and signature mannerisms, and stores the result as a brand voice profile.
        Every future cluster brief and full-post draft picks up the active profile automatically — generated
        copy stops sounding like generic Claude and starts sounding like the brand.
      </p>

      {err && <div className="callout callout-danger mb-3">{err}</div>}

      <div className="card mb-5">
        <div className="caption mb-2">URLs to analyse (one per line, 1–12)</div>
        <textarea
          value={urlsText} onChange={e => setUrlsText(e.target.value)} rows={6}
          placeholder="https://yoursite.com/blog/post-that-sounds-most-like-the-brand\nhttps://yoursite.com/about\nhttps://yoursite.com/blog/another-on-brand-post"
          style={{ width: '100%', padding: '10px 12px', fontSize: 13, lineHeight: 1.5, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', fontFamily: 'ui-monospace, Menlo, Consolas, monospace', boxSizing: 'border-box', resize: 'vertical' }}
        />
        <div className="row between center mt-2">
          <span className="body-xs text-subtle">{urlCount} URL{urlCount === 1 ? '' : 's'} · {urlCount < 1 ? 'paste at least 1' : urlCount > 12 ? 'max 12' : 'ready'}</span>
          <button onClick={run} className="btn btn-primary" disabled={running || urlCount < 1 || urlCount > 12}>
            {running ? 'Extracting…' : profile ? 'Re-extract' : 'Extract voice profile'}
          </button>
        </div>
      </div>

      {loading && !profile ? (
        <div style={{ color: 'var(--text-subtle)', padding: 20 }}>Loading…</div>
      ) : !profile ? (
        <div className="card">
          <p className="body-sm text-subtle">
            {running ? 'Extracting voice profile — this usually takes 30–60 seconds.' : 'No voice profile yet. Paste a few URLs above and click Extract.'}
          </p>
        </div>
      ) : (
        <ProfileView profile={profile} />
      )}

      {history.length > 1 && (
        <div className="mt-5">
          <div className="caption mb-2">History</div>
          <div className="card" style={{ padding: 0 }}>
            <table className="table">
              <thead><tr><th>Date</th><th>Sources</th><th>Status</th></tr></thead>
              <tbody>
                {history.slice(0, 10).map(h => (
                  <tr key={h.id}>
                    <td>{new Date(h.started_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                    <td>{Array.isArray(h.source_urls) ? h.source_urls.length : 0} URLs</td>
                    <td style={{ textTransform: 'uppercase', fontSize: 11, color: h.status === 'failed' ? 'var(--negative)' : h.status === 'running' ? 'var(--warning)' : 'var(--text-muted)' }}>{h.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function ProfileView({ profile }) {
  const tones = Array.isArray(profile.tone_descriptors) ? profile.tone_descriptors : [];
  const vocab = Array.isArray(profile.vocabulary_patterns) ? profile.vocabulary_patterns : [];
  const signature = Array.isArray(profile.signature_phrases) ? profile.signature_phrases : [];
  const avoid = Array.isArray(profile.avoid_phrases) ? profile.avoid_phrases : [];
  const dos = Array.isArray(profile.do_examples) ? profile.do_examples : [];
  const donts = Array.isArray(profile.dont_examples) ? profile.dont_examples : [];

  return (
    <>
      {profile.voice_summary && (
        <div className="card mb-4" style={{ background: 'var(--accent-soft)' }}>
          <div className="caption">Voice summary</div>
          <p className="body mt-2" style={{ color: 'var(--text)' }}>{profile.voice_summary}</p>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--s3)', marginBottom: 'var(--s5)' }}>
        <StatCard label="Reading level" value={profile.reading_level || '—'} />
        <StatCard label="Avg sentence" value={profile.avg_sentence_length_words ? `${profile.avg_sentence_length_words}w` : '—'} />
        <StatCard label="Avg paragraph" value={profile.avg_paragraph_length_sentences ? `${profile.avg_paragraph_length_sentences} sentences` : '—'} />
        <StatCard label="Sources" value={(Array.isArray(profile.source_urls) ? profile.source_urls.length : 0)} />
      </div>

      {!!tones.length && (
        <div className="card mb-4">
          <div className="caption mb-2">Tone</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {tones.map(t => (
              <span key={t} style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 'var(--r-pill)', background: 'var(--accent)', color: 'var(--accent-on)' }}>{t}</span>
            ))}
          </div>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 'var(--s4)', marginBottom: 'var(--s4)' }}>
        {!!vocab.length && (
          <div className="card">
            <div className="caption mb-2">Vocabulary patterns</div>
            <ul style={{ margin: 0, padding: '0 0 0 18px', fontSize: 13, lineHeight: 1.7 }}>
              {vocab.map((v, i) => <li key={i}>{v}</li>)}
            </ul>
          </div>
        )}
        <div className="card">
          {!!signature.length && (
            <>
              <div className="caption mb-2" style={{ color: 'var(--positive)' }}>Signature phrases</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 'var(--s3)' }}>
                {signature.map((s, i) => <span key={i} style={{ fontSize: 12, padding: '2px 8px', borderRadius: 'var(--r-sm)', background: 'var(--positive-soft)', color: 'var(--positive)' }}>"{s}"</span>)}
              </div>
            </>
          )}
          {!!avoid.length && (
            <>
              <div className="caption mb-2" style={{ color: 'var(--negative)' }}>Avoid</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {avoid.map((s, i) => <span key={i} style={{ fontSize: 12, padding: '2px 8px', borderRadius: 'var(--r-sm)', background: 'var(--negative-soft)', color: 'var(--negative)' }}>"{s}"</span>)}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 'var(--s4)' }}>
        {!!dos.length && (
          <div className="card">
            <div className="caption mb-2" style={{ color: 'var(--positive)' }}>Do — sounds like this brand</div>
            <ul style={{ margin: 0, padding: '0 0 0 18px', fontSize: 13, lineHeight: 1.7 }}>
              {dos.map((s, i) => <li key={i} style={{ color: 'var(--text)' }}>✓ {s}</li>)}
            </ul>
          </div>
        )}
        {!!donts.length && (
          <div className="card">
            <div className="caption mb-2" style={{ color: 'var(--negative)' }}>Don't — would feel off-brand</div>
            <ul style={{ margin: 0, padding: '0 0 0 18px', fontSize: 13, lineHeight: 1.7 }}>
              {donts.map((s, i) => <li key={i} style={{ color: 'var(--text-muted)' }}>✗ {s}</li>)}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="card">
      <div className="caption">{label}</div>
      <div className="metric" style={{ marginTop: 4 }}>{value}</div>
    </div>
  );
}
