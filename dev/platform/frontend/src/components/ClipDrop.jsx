import React, { useRef, useState } from 'react';
import { api } from '../utils/api';

/**
 * Footage, in.
 *
 * "Can I drop several clips in at once?" — no, and the reason was structural
 * rather than a missing feature. The only way footage entered OMI was the
 * single-file picker on this step, which turns one clip into one draft edit
 * job. Drop five and four are discarded; there was nowhere to put them,
 * because the asset library took no uploads at all.
 *
 * One target, two outcomes, decided by how many files arrive:
 *
 *  - One file goes straight into the editor, which is the fastest path to the
 *    thing you came here to do and is exactly what the old button did.
 *  - Several go into the client's library, and you pick the one to start with
 *    from the grid below. That is what dropping five clips means: file them,
 *    then choose.
 *
 * Two upload affordances side by side would have been the two-doors problem
 * this review keeps finding, so there is one.
 */

const LINE = 'var(--border-w) solid var(--card-border)';
const CAP = { fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)' };

// What the server will take. Checked here as well so a rejected file says so
// before half a gigabyte goes up the wire.
const OK = /^(video|image|audio)\//;
const MAX_BYTES = 500 * 1024 * 1024;
const MAX_FILES = 25;

function reject(file) {
  const m = String(file.type || '').toLowerCase();
  if (m === 'image/svg+xml') return 'SVG belongs in the brand kit, not here';
  if (!OK.test(m)) return 'not a clip, an image or audio';
  if (file.size > MAX_BYTES) return 'over 500MB';
  return null;
}

export default function ClipDrop({ clientId, clientName, disabled = false,
  onOne, onFiled }) {
  const fileRef = useRef(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState(null);
  const [bad, setBad] = useState([]);

  async function take(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length || disabled || busy) return;
    setNote(null);

    const rejected = files.map((f) => ({ f, why: reject(f) })).filter((r) => r.why);
    const good = files.filter((f) => !reject(f));
    setBad(rejected.map((r) => `${r.f.name} — ${r.why}`));
    if (!good.length) return;

    // One clip: the editor, as before. Nothing is filed, because the edit job
    // records its own output when it renders.
    if (good.length === 1) { onOne(good[0]); return; }

    setBusy(`Filing ${good.length} files…`);
    try {
      const fd = new FormData();
      good.forEach((f) => fd.append('files', f));
      const r = await api.postForm(`/clients/${clientId}/assets/upload`, fd);
      const n = r.added?.length || 0;
      setNote(n
        ? `${n} file${n === 1 ? '' : 's'} filed${r.failed?.length ? `, ${r.failed.length} could not be` : ''}.`
          + ' Pick the one to start with.'
        : 'Nothing was filed.');
      if (n) onFiled();
    } catch (e) {
      setNote(e.message);
    } finally { setBusy(''); }
  }

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer?.files); }}
        onClick={() => !disabled && !busy && fileRef.current?.click()}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label="Add footage"
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click(); } }}
        style={{
          border: over ? 'var(--border-w) dashed var(--accent)' : `${LINE.replace('solid', 'dashed')}`,
          borderRadius: 'var(--r-md)', padding: 'var(--s5) var(--s4)', textAlign: 'center',
          background: over ? 'var(--accent-soft, var(--surface))' : 'transparent',
          cursor: disabled || busy ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
        }}
      >
        <div style={{ fontWeight: 700 }}>
          {busy || (over ? 'Let go' : 'Drop your clips here, or click to choose')}
        </div>
        <div style={{ ...CAP, marginTop: 4, lineHeight: 1.5 }}>
          One clip opens straight in the editor. Several are filed in
          {clientName ? ` ${clientName}’s` : ' this client’s'} library and you pick the one to start
          with. Up to {MAX_FILES} at a time, 500MB each.
        </div>
      </div>
      <input ref={fileRef} type="file" multiple accept="video/*,image/*,audio/*"
        style={{ display: 'none' }}
        onChange={(e) => { take(e.target.files); e.target.value = ''; }} />

      {note && (
        <div style={{ ...CAP, marginTop: 'var(--s2)', color: 'var(--text-muted)' }}>{note}</div>
      )}
      {bad.length > 0 && (
        <ul style={{ ...CAP, margin: 'var(--s2) 0 0', paddingLeft: 'var(--s4)', color: 'var(--negative)' }}>
          {/* Named, not counted. "3 files were rejected" leaves you to work out
              which three, and the answer is usually one wrong drag. */}
          {bad.map((b) => <li key={b}>{b}</li>)}
        </ul>
      )}
    </div>
  );
}
