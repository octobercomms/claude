import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

// Public player for a shared recording (/watch/:token). No login — reached via
// the unguessable share link. Streams from the platform (disk or R2) and pings
// view progress so the owner can see "did they watch it". Standalone page (no
// app shell), styled dark like a video viewer.

export default function WatchPage() {
  const { token } = useParams();
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const videoRef = useRef(null);
  const viewIdRef = useRef(null);
  const lastPingRef = useRef(0);

  useEffect(() => {
    let alive = true;
    fetch(`/api/public/watch/${encodeURIComponent(token)}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(r.status === 404 ? 'This recording isn’t available.' : 'Something went wrong.')))
      .then(m => { if (alive) setMeta(m); })
      .catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [token]);

  // Fire a view/progress ping. First call records the view; later calls update
  // how far they got. Best-effort — never block playback on it.
  function ping(watchSeconds) {
    const body = JSON.stringify({ view_id: viewIdRef.current || undefined, watch_seconds: Math.round(watchSeconds || 0) });
    fetch(`/api/public/watch/${encodeURIComponent(token)}/view`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true,
    }).then(r => r.ok ? r.json() : null).then(j => { if (j && j.view_id) viewIdRef.current = j.view_id; }).catch(() => {});
  }

  function onPlay() { if (!viewIdRef.current) ping(0); }
  function onTimeUpdate(e) {
    const t = e.target.currentTime;
    if (t - lastPingRef.current >= 10) { lastPingRef.current = t; ping(t); }
  }
  useEffect(() => {
    const flush = () => { const v = videoRef.current; if (v && viewIdRef.current) ping(v.currentTime); };
    window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('pagehide', flush); flush(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: '#0d0d0f', color: '#f4f4f5', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 16px', fontFamily: 'Brockmann, -apple-system, "Segoe UI", Roboto, sans-serif' }}>
      <div style={{ width: '100%', maxWidth: 960 }}>
        <div style={{ fontSize: 12, letterSpacing: '.12em', textTransform: 'uppercase', color: '#8a8a92', fontWeight: 700, marginBottom: 14 }}>October</div>
        {error ? (
          <div style={{ padding: '60px 0', textAlign: 'center', color: '#c9c9d0' }}>{error}</div>
        ) : !meta ? (
          <div style={{ padding: '60px 0', textAlign: 'center', color: '#8a8a92' }}>Loading…</div>
        ) : (
          <>
            <div style={{ background: '#000', borderRadius: 14, overflow: 'hidden', boxShadow: '0 12px 40px rgba(0,0,0,.5)' }}>
              <video
                ref={videoRef}
                src={meta.stream_url}
                controls
                autoPlay
                onPlay={onPlay}
                onTimeUpdate={onTimeUpdate}
                style={{ width: '100%', display: 'block', maxHeight: '72vh', background: '#000' }}
              />
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 800, margin: '18px 0 4px' }}>{meta.title}</h1>
            <div style={{ fontSize: 13, color: '#8a8a92' }}>
              {meta.created_at ? new Date(meta.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : ''}
            </div>
            {meta.transcript && (
              <div style={{ marginTop: 20 }}>
                <button onClick={() => setShowTranscript(s => !s)}
                  style={{ background: 'transparent', color: '#c9c9d0', border: '1px solid #2c2c33', borderRadius: 999, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {showTranscript ? 'Hide transcript' : 'Show transcript'}
                </button>
                {showTranscript && (
                  <div style={{ marginTop: 14, whiteSpace: 'pre-wrap', lineHeight: 1.6, fontSize: 14, color: '#d4d4d8', maxHeight: 320, overflowY: 'auto', padding: 16, background: '#16161a', borderRadius: 10 }}>
                    {meta.transcript}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
