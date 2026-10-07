import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

// Country exclusions for one press release, plus the coverage figure that says
// whether they can be trusted.
//
// Country is derived from data OMI already holds (the outlet, the location text,
// the email TLD) with no AI call, and an unresolved country stays unknown rather
// than being guessed. That makes the coverage number the important part of this
// screen: excluding the United States on a library where 30% of contacts have a
// country means you have filtered 30% of your list, and the panel says so rather
// than implying the job is done.
//
// Unknowns are never handled silently. Each release chooses whether a contact
// with no country still sends or is held back, and the count sits next to the
// choice.

const LINE = 'var(--border-w) solid var(--card-border)';
const CAP = { fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)' };

export default function PressCountryExclusions({ releaseId, readOnly }) {
  const toast = useToast();
  const [cov, setCov] = useState(null);
  const [excluded, setExcluded] = useState([]);
  const [policy, setPolicy] = useState('send');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, x] = await Promise.all([
        api.get('/press/countries'),
        api.get(`/press/releases/${releaseId}/country-exclusions`),
      ]);
      setCov(c);
      setExcluded(x.excluded_countries || []);
      setPolicy(x.unknown_country_policy || 'send');
      setDirty(false);
    } catch (e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [releaseId]);

  useEffect(() => { load(); }, [load]);

  async function save() {
    setSaving(true);
    try {
      await api.put(`/press/releases/${releaseId}/country-exclusions`, {
        excluded_countries: excluded, unknown_country_policy: policy,
      });
      toast(excluded.length
        ? `${excluded.length} countr${excluded.length === 1 ? 'y' : 'ies'} excluded from this release.`
        : 'Country exclusions cleared.', 'success');
      setDirty(false);
    } catch (e) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  }

  async function backfill() {
    setBackfilling(true);
    try {
      const r = await api.post('/press/countries/backfill', {});
      const sources = Object.entries(r.by_source || {}).map(([k, n]) => `${n} from ${k}`).join(', ');
      toast(`Resolved ${r.updated} more${sources ? ` (${sources})` : ''}. ${r.coverage_pct}% of the library now has a country.`, 'success');
      await load();
    } catch (e) { toast(e.message, 'error'); }
    finally { setBackfilling(false); }
  }

  const toggle = (name) => {
    setExcluded((p) => (p.includes(name) ? p.filter((x) => x !== name) : [...p, name]));
    setDirty(true);
  };

  if (loading) return <div className="card" style={{ padding: 'var(--s4)', marginTop: 'var(--s4)' }}><div style={CAP}>Loading…</div></div>;

  const thin = cov && cov.coverage_pct < 60;
  // Countries in the list that no contact currently has: usually a leftover from
  // a previous release. Worth showing so an exclusion that does nothing is visible.
  const known = new Set((cov?.by_country || []).map((r) => r.country));
  const stale = excluded.filter((c) => !known.has(c));

  return (
    <div className="card" style={{ padding: 'var(--s4)', marginTop: 'var(--s4)' }}>
      <div className="h3">Countries</div>
      <div style={{ ...CAP, marginTop: 'var(--s1)' }}>
        Hold back journalists in particular countries for this release. Country comes from the
        publication, the contact's location or their email domain, never from a guess.
      </div>

      {cov && (
        <div style={{ marginTop: 'var(--s3)', padding: 'var(--s3)', borderRadius: 'var(--r-sm)', border: LINE }}>
          <div className="row center" style={{ justifyContent: 'space-between', gap: 'var(--s3)', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700 }}>
                {cov.coverage_pct}% of the media library has a country
              </div>
              <div style={CAP}>
                {cov.with_country.toLocaleString()} of {cov.contacts.toLocaleString()} contacts ·{' '}
                {cov.unknown.toLocaleString()} unknown
              </div>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={backfill} disabled={backfilling || readOnly}>
              {backfilling ? 'Resolving…' : 'Resolve more countries'}
            </button>
          </div>
          {cov.by_source?.length > 0 && (
            <div style={{ ...CAP, marginTop: 'var(--s2)' }}>
              Derived from: {cov.by_source.map((r) => `${r.n.toLocaleString()} ${r.source}`).join(', ')}.
              Resolving is free, no AI.
            </div>
          )}
          {thin && (
            <div style={{ ...CAP, marginTop: 'var(--s2)', color: 'var(--text-muted)' }}>
              With {cov.coverage_pct}% coverage, a country exclusion only filters the contacts that have
              one. Decide below what happens to the {cov.unknown.toLocaleString()} unknown.
            </div>
          )}
        </div>
      )}

      {cov?.by_country?.length > 0 ? (
        <>
          <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--text-muted)', margin: 'var(--s4) 0 var(--s2)' }}>
            Exclude from this release
          </div>
          <div className="row wrap" style={{ gap: 'var(--s1)' }}>
            {cov.by_country.map((r) => {
              const on = excluded.includes(r.country);
              return (
                <button key={r.country} className={`chip ${on ? 'chip-on' : ''}`} disabled={readOnly}
                  onClick={() => toggle(r.country)}
                  style={{ cursor: readOnly ? 'default' : 'pointer', fontWeight: on ? 700 : 400,
                    textDecoration: on ? 'line-through' : 'none' }}
                  title={on ? `${r.country} is excluded from this release` : `Exclude ${r.country}`}>
                  {r.country} {r.n.toLocaleString()}
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <div style={{ ...CAP, marginTop: 'var(--s3)' }}>
          No contact has a country yet. Press "Resolve more countries" above to derive them from the
          data already on file.
        </div>
      )}

      {stale.length > 0 && (
        <div style={{ ...CAP, marginTop: 'var(--s2)' }}>
          Also excluded, but no contact currently has it: {stale.join(', ')}.
        </div>
      )}

      <div style={{ marginTop: 'var(--s4)', paddingTop: 'var(--s3)', borderTop: LINE }}>
        <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 'var(--s2)' }}>
          Journalists whose country is unknown {cov ? `(${cov.unknown.toLocaleString()})` : ''}
        </div>
        {[['send', 'Still send to them', 'Only journalists positively identified in an excluded country are held back.'],
          ['hold', 'Hold them back too', 'Anyone not positively identified as outside the excluded countries waits.']]
          .map(([v, label, hint]) => (
          <label key={v} className="row" style={{ gap: 'var(--s2)', alignItems: 'flex-start', padding: 'var(--s1) 0', cursor: readOnly ? 'default' : 'pointer' }}>
            <input type="radio" name={`unknown-${releaseId}`} checked={policy === v} disabled={readOnly}
              onChange={() => { setPolicy(v); setDirty(true); }} style={{ marginTop: 4 }} />
            <div>
              <div style={{ fontSize: 'var(--fs-body)', fontWeight: 600 }}>{label}</div>
              <div style={CAP}>{hint}</div>
            </div>
          </label>
        ))}
        {policy === 'hold' && cov && excluded.length > 0 && (
          <div style={{ ...CAP, marginTop: 'var(--s1)' }}>
            This holds back {cov.unknown.toLocaleString()} contacts on top of the excluded countries.
          </div>
        )}
      </div>

      {!readOnly && (
        <button className="btn btn-primary btn-sm" style={{ marginTop: 'var(--s3)' }}
          onClick={save} disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save country rules'}
        </button>
      )}
      <div style={{ ...CAP, marginTop: 'var(--s2)' }}>
        Enforced when each email is sent, not only when the list is built, so a country corrected after
        you press Send is still respected.
      </div>
    </div>
  );
}
