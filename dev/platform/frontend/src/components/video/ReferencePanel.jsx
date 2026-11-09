import React, { useState } from 'react';
import AssetLibrary from '../AssetLibrary';
import FeatureCost from '../FeatureCost';
import { api } from '../../utils/api';

/**
 * Propose a shape from somebody else's finished video.
 *
 * "Is there a way to upload someone's video to be analysed and build a
 * template from it?" This is the answer, and what it shows is a READING with
 * a confidence and a reason per field, not a template that silently becomes
 * truth. Every row says how sure it is and why, because the whole point of
 * the proposal is that an operator confirms it.
 *
 * Two things it deliberately does not do.
 *
 * It does not save. Templates are shipped JSON files in `shared/templates/`,
 * so a proposal is copied out and committed, which is how the eight shipped
 * shapes got there. The button says Copy rather than Save, and the panel says
 * why, because a Save that quietly did nothing is worse than no Save.
 *
 * It does not read the caption treatment unless asked. That is the one part
 * of this that spends anything — eight sampled frames to a model that takes
 * images — so it is a checkbox with the cost beside it, and everything else
 * is ffmpeg and free.
 */
export default function ReferencePanel({ clientId }) {
  const [asset, setAsset] = useState(null);
  const [readCaptions, setReadCaptions] = useState(false);
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  const analyse = async () => {
    if (!asset) return;
    setBusy(true);
    setError(null);
    setOut(null);
    try {
      const result = await api.post(`/compose/clients/${clientId}/analyse-reference`, {
        assetId: asset.id,
        readCaptions,
      });
      setOut(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(out.template, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not reach the clipboard. Select the JSON below instead.');
    }
  };

  return (
    <section className="card">
      <h2>Propose a shape from a reference</h2>
      <p style={{ color: 'var(--text-muted)' }}>
        Point it at a reel and it reads the cut rhythm, the shot lengths, how much the pictures
        move and, if you ask, the caption treatment. What comes back is a reading to confirm,
        with a reason for every field and a plain note where it could not tell.
      </p>

      <AssetLibrary
        clientId={clientId}
        kind="video"
        compact
        onPick={(a) => { setAsset(a); setOut(null); }}
      />

      {asset && (
        <div style={{ marginTop: 'var(--s3)' }}>
          <div className="chip">{asset.title || `Asset ${asset.id}`}</div>
        </div>
      )}

      <label style={{
        display: 'flex', alignItems: 'center', gap: 'var(--s2)',
        marginTop: 'var(--s3)', flexWrap: 'wrap',
      }}>
        <input
          type="checkbox"
          checked={readCaptions}
          onChange={(e) => setReadCaptions(e.target.checked)}
          disabled={busy}
        />
        <span>Read the caption treatment</span>
        {/* The one part of this that costs anything. */}
        <FeatureCost feature="reference_caption_read" />
      </label>
      <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-caption)', margin: 'var(--s1) 0 0' }}>
        Eight frames go to a model that reads type. The answer is matched to one of the 31
        shipped caption presets, never a new one, and it comes back as a shortlist when a still
        frame cannot tell two of them apart. Everything else on this panel is free.
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', marginTop: 'var(--s3)' }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!asset || busy}
          onClick={analyse}
        >
          {busy ? 'Reading…' : 'Read it'}
        </button>
      </div>

      {error && <div className="chip chip-warning" style={{ marginTop: 'var(--s3)' }}>{error}</div>}

      {out && (
        <div style={{ marginTop: 'var(--s4)' }}>
          <p style={{ fontSize: '1.1em' }}>{out.says}</p>
          {out.captionSays && (
            <p style={{ color: 'var(--text-muted)' }}>Captions: {out.captionSays}</p>
          )}

          <table style={{ width: '100%', marginTop: 'var(--s3)' }}>
            <tbody>
              {Object.entries(out.fields || {}).map(([name, field]) => (
                <tr key={name} style={{ borderTop: '1px solid var(--card-border)' }}>
                  <td style={{ padding: 'var(--s2) 0', width: '7em', verticalAlign: 'top' }}>
                    <strong>{LABEL[name] || name}</strong>
                  </td>
                  <td style={{ padding: 'var(--s2) 0', verticalAlign: 'top' }}>
                    <div>{show(field.value)}</div>
                    {!!(field.alternatives || []).length && (
                      <div style={{ color: 'var(--text-muted)' }}>
                        or {field.alternatives.join(', ')}
                      </div>
                    )}
                    <div style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-caption)' }}>
                      {field.why}
                    </div>
                  </td>
                  <td style={{ padding: 'var(--s2) 0', width: '6em', textAlign: 'right', verticalAlign: 'top' }}>
                    <span className={`chip ${field.confidence >= 0.7 ? 'chip-success'
                      : field.confidence > 0 ? '' : 'chip-warning'}`}>
                      {field.confidence > 0 ? `${Math.round(field.confidence * 100)}%` : 'not read'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {out.template && (
            <>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 'var(--s3)', marginTop: 'var(--s4)',
              }}>
                <button type="button" className="btn btn-secondary btn-sm" onClick={copy}>
                  {copied ? 'Copied' : 'Copy the template JSON'}
                </button>
                <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-caption)' }}>
                  Templates are files in the repository, so a proposal is committed rather than
                  saved from here.
                </span>
              </div>
              <pre style={{
                marginTop: 'var(--s3)', padding: 'var(--s3)', overflowX: 'auto',
                background: 'var(--surface-sunken)', borderRadius: 'var(--r-md)',
                fontSize: 'var(--fs-caption)',
              }}>
                {JSON.stringify(out.template, null, 2)}
              </pre>
            </>
          )}
        </div>
      )}
    </section>
  );
}

const LABEL = {
  size: 'Frame',
  fps: 'Rate',
  len: 'Shot length',
  motion: 'Movement',
  caption: 'Caption preset',
  margin: 'Caption position',
  count: 'How many',
  loudness: 'Loudness',
};

function show(value) {
  if (value == null) return '—';
  if (typeof value === 'object') {
    if ('width' in value) return `${value.width} × ${value.height}`;
    if ('min' in value) return `${value.min} to ${value.max}`;
    return JSON.stringify(value);
  }
  return String(value);
}
