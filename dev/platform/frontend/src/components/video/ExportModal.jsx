import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../utils/api';
import { useToast } from '../../context/ToastContext';
import { duration as compDuration } from '@shared/composition.mjs';

// ── Resolution presets ──────────────────────────────────────────────────────

const QUALITY_OPTIONS = [
  { value: 'high',   label: 'High',   crf: 18, bitrateKbps: 8000 },
  { value: 'medium', label: 'Medium', crf: 23, bitrateKbps: 4000 },
  { value: 'low',    label: 'Low',    crf: 28, bitrateKbps: 2000 },
];

function resolutionPresets(comp) {
  const w = comp.size?.width || 1080;
  const h = comp.size?.height || 1920;
  return [
    { value: 'native', label: `Match composition (${w}x${h})`, width: w, height: h },
    { value: '1080p',  label: '1080p (1920x1080)', width: 1920, height: 1080 },
    { value: '720p',   label: '720p (1280x720)',   width: 1280, height: 720  },
    { value: '480p',   label: '480p (854x480)',     width: 854,  height: 480  },
  ];
}

function estimateFileSize(durationSecs, bitrateKbps) {
  if (!durationSecs || durationSecs <= 0) return null;
  const bytes = (bitrateKbps * 1000 / 8) * durationSecs;
  if (bytes >= 1024 * 1024 * 1024) return `~${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `~${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `~${(bytes / 1024).toFixed(0)} KB`;
}

function formatDuration(secs) {
  if (!secs || secs <= 0) return '0s';
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// ── Polling interval ────────────────────────────────────────────────────────

const POLL_MS = 2000;

// ── State machine: configure -> rendering -> complete | failed ──────────────

const PHASE = { CONFIGURE: 'configure', RENDERING: 'rendering', COMPLETE: 'complete', FAILED: 'failed' };

// ── Component ───────────────────────────────────────────────────────────────

export default function ExportModal({ compId, composition, onClose }) {
  const toast = useToast();
  const pollRef = useRef(null);
  const closingRef = useRef(false);

  const [phase, setPhase] = useState(PHASE.CONFIGURE);
  const [format] = useState('mp4');
  const [resolution, setResolution] = useState('native');
  const [quality, setQuality] = useState('high');
  const [progress, setProgress] = useState(0);
  const [outputUrl, setOutputUrl] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [starting, setStarting] = useState(false);

  const total = compDuration(composition);
  const presets = resolutionPresets(composition);
  const qualityObj = QUALITY_OPTIONS.find(q => q.value === quality) || QUALITY_OPTIONS[0];
  const sizeEstimate = estimateFileSize(total, qualityObj.bitrateKbps);

  // ── Cleanup polling on unmount ──────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // ── Lock body scroll while modal is open ────────────────────────────────

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // ── Escape to close ─────────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  // ── Start render ────────────────────────────────────────────────────────

  const startRender = useCallback(async () => {
    if (!compId) { toast('No composition to export.', 'error'); return; }
    setStarting(true);

    const res = presets.find(p => p.value === resolution) || presets[0];

    try {
      await api.post(`/compose/compositions/${compId}/render`, {
        format,
        resolution: { width: res.width, height: res.height },
        quality,
      });
      setPhase(PHASE.RENDERING);
      setProgress(0);
      startPolling();
    } catch (err) {
      toast(err.message || 'Failed to start render.', 'error');
      setErrorMsg(err.message || 'Failed to start render.');
      setPhase(PHASE.FAILED);
    } finally {
      setStarting(false);
    }
  }, [compId, format, resolution, quality, toast]);

  // ── Poll render status ──────────────────────────────────────────────────

  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);

    pollRef.current = setInterval(async () => {
      try {
        const status = await api.get(`/compose/compositions/${compId}/render-status`);
        setProgress(status.progress || 0);

        if (status.status === 'done') {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setOutputUrl(status.outputUrl || null);
          setPhase(PHASE.COMPLETE);
        } else if (status.status === 'failed') {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setErrorMsg(status.error || 'Render failed.');
          setPhase(PHASE.FAILED);
        }
      } catch (err) {
        // Polling errors are transient; keep trying unless component unmounted.
      }
    }, POLL_MS);
  }, [compId]);

  // ── Close handler — warns if render in progress ─────────────────────────

  const handleClose = useCallback(() => {
    if (phase === PHASE.RENDERING) {
      if (!window.confirm('Render in progress. Close anyway?')) return;
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }
    onClose();
  }, [phase, onClose]);

  // ── Auto-download on complete ───────────────────────────────────────────

  useEffect(() => {
    if (phase === PHASE.COMPLETE && outputUrl && !closingRef.current) {
      triggerDownload(outputUrl);
    }
  }, [phase, outputUrl]);

  function triggerDownload(url) {
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // ── Retry after failure ─────────────────────────────────────────────────

  const retry = useCallback(() => {
    setErrorMsg(null);
    setProgress(0);
    setPhase(PHASE.CONFIGURE);
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="modal-backdrop" onClick={handleClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 className="h2" style={{ margin: 0 }}>Export video</h2>
          <button type="button" className="modal-close" onClick={handleClose}>×</button>
        </div>

        {/* ── Configure phase ────────────────────────────────────────── */}
        {phase === PHASE.CONFIGURE && (
          <>
            {/* Format */}
            <div className="field" style={{ marginBottom: 'var(--s4)' }}>
              <label className="body-xs text-subtle" style={{ display: 'block', marginBottom: 'var(--s1)' }}>
                Format
              </label>
              <select className="input" value={format} disabled
                style={{ width: '100%', fontSize: 'var(--fs-body)' }}>
                <option value="mp4">MP4</option>
              </select>
            </div>

            {/* Resolution */}
            <div className="field" style={{ marginBottom: 'var(--s4)' }}>
              <label className="body-xs text-subtle" style={{ display: 'block', marginBottom: 'var(--s1)' }}>
                Resolution
              </label>
              <select className="input" value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                style={{ width: '100%', fontSize: 'var(--fs-body)' }}>
                {presets.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>

            {/* Quality */}
            <div className="field" style={{ marginBottom: 'var(--s4)' }}>
              <label className="body-xs text-subtle" style={{ display: 'block', marginBottom: 'var(--s1)' }}>
                Quality
              </label>
              <div style={{ display: 'flex', gap: 'var(--s1)', flexWrap: 'wrap' }}>
                {QUALITY_OPTIONS.map(q => (
                  <button key={q.value} type="button"
                    className={`btn-chip${quality === q.value ? ' is-active' : ''}`}
                    onClick={() => setQuality(q.value)}>
                    {q.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Estimate */}
            <div className="body-xs text-muted" style={{
              marginBottom: 'var(--s5)',
              fontVariantNumeric: 'tabular-nums',
            }}>
              Duration: {formatDuration(total)}
              {sizeEstimate && <> &middot; Est. size: {sizeEstimate}</>}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--s2)' }}>
              <button type="button" className="btn btn-secondary" onClick={handleClose}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={startRender}
                disabled={starting || total <= 0}>
                {starting ? 'Starting...' : 'Export'}
              </button>
            </div>
          </>
        )}

        {/* ── Rendering phase ────────────────────────────────────────── */}
        {phase === PHASE.RENDERING && (
          <>
            <div style={{ marginBottom: 'var(--s4)' }}>
              <div className="body-sm" style={{ marginBottom: 'var(--s2)', fontVariantNumeric: 'tabular-nums' }}>
                Rendering... {Math.round(progress)}%
              </div>
              {/* Progress bar */}
              <div style={{
                width: '100%',
                height: 8,
                background: 'var(--surface-sunken)',
                borderRadius: 'var(--r-pill)',
                overflow: 'hidden',
              }}>
                <div style={{
                  width: `${Math.min(100, Math.max(0, progress))}%`,
                  height: '100%',
                  background: 'var(--primary)',
                  borderRadius: 'var(--r-pill)',
                  transition: 'width 0.3s ease',
                }} />
              </div>
            </div>

            <div className="body-xs text-muted" style={{ marginBottom: 'var(--s5)' }}>
              This may take a few minutes depending on the composition length.
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-secondary" onClick={handleClose}>
                Cancel
              </button>
            </div>
          </>
        )}

        {/* ── Complete phase ─────────────────────────────────────────── */}
        {phase === PHASE.COMPLETE && (
          <>
            <div style={{
              padding: 'var(--s4)',
              background: 'var(--positive-soft)',
              borderRadius: 'var(--r-sm)',
              marginBottom: 'var(--s4)',
            }}>
              <div className="body-sm" style={{ fontWeight: 600, color: 'var(--positive)', marginBottom: 'var(--s1)' }}>
                Export complete
              </div>
              <div className="body-xs text-muted">
                Duration: {formatDuration(total)}
                {sizeEstimate && <> &middot; Est. size: {sizeEstimate}</>}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--s2)' }}>
              <button type="button" className="btn btn-secondary" onClick={handleClose}>
                Close
              </button>
              {outputUrl && (
                <a className="btn btn-primary" href={outputUrl} download
                  style={{ textDecoration: 'none' }}>
                  Download
                </a>
              )}
            </div>
          </>
        )}

        {/* ── Failed phase ───────────────────────────────────────────── */}
        {phase === PHASE.FAILED && (
          <>
            <div style={{
              padding: 'var(--s4)',
              background: 'var(--negative-soft)',
              borderRadius: 'var(--r-sm)',
              marginBottom: 'var(--s4)',
            }}>
              <div className="body-sm" style={{ fontWeight: 600, color: 'var(--negative)', marginBottom: 'var(--s1)' }}>
                Export failed
              </div>
              <div className="body-xs text-muted">
                {errorMsg || 'An unexpected error occurred during rendering.'}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--s2)' }}>
              <button type="button" className="btn btn-secondary" onClick={handleClose}>
                Close
              </button>
              <button type="button" className="btn btn-primary" onClick={retry}>
                Try again
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
