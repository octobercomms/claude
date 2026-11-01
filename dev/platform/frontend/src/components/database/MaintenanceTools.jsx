import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { SECTIONS, slugForTab } from '../../nav/sections';
import { api } from '../../utils/api';
import { useToast } from '../../context/ToastContext';
import { roWrite } from '../../utils/readOnly';
import { useAuth } from '../../context/AuthContext';
import TagTidyTool from './TagTidyTool';

// Built from sections.js rather than typed, because a typed path is how the
// link to the review queue rots the next time the Journalists slug moves.
// routeTargets.test.mjs caught this one as a literal before it ever shipped.
const JOURNALISTS = `${SECTIONS.database.base()}/${slugForTab(SECTIONS.database, 'contacts')}`;

// Every maintenance job on the media database, in one place.
//
// "so its one mega cleanup centre?" — yes. They were scattered: two buttons
// in a grey strip above Find new journalists, one beside the Tags heading,
// one as the primary action on Publications. Four screens, no pattern, and
// the only way to learn any of them existed was to be on the right screen on
// the right day.
//
// Each one here says what it does, what it costs you in time, and when it
// runs on its own — because most of them do, and a button you press for
// something that already happens nightly is a button you press for nothing.
function Tool({ title, note, schedule, children, result }) {
  return (
    <div className="card" style={{ display: 'grid', gap: 'var(--s2)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        gap: 'var(--s3)', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <div className="h3" style={{ margin: 0 }}>{title}</div>
          <p className="body-sm text-muted" style={{ margin: 'var(--s2) 0 0', maxWidth: 620, lineHeight: 1.55 }}>
            {note}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap' }}>{children}</div>
      </div>
      {schedule && (
        <p className="body-xs text-subtle" style={{ margin: 0 }}>{schedule}</p>
      )}
      {result && (
        <p className="body-sm" style={{ margin: 0, padding: 'var(--s2) var(--s3)',
          background: 'var(--surface-raised, #fafafa)', borderRadius: 'var(--r-sm)' }}>
          {result}
        </p>
      )}
    </div>
  );
}

export default function MaintenanceTools() {
  const toast = useToast();
  const { readOnly } = useAuth();
  const [busy, setBusy] = useState(null);
  const [results, setResults] = useState({});
  const say = (k, text) => setResults((r) => ({ ...r, [k]: text }));

  // These used to live on the screen their results landed on, which is what
  // made moving them a real cost rather than a tidy-up. The answer is that
  // each one reports what it did here, and names where the results are, so
  // nothing is lost beyond the list refreshing under you.
  async function findFeeds() {
    setBusy('feeds');
    try {
      const known = await api.post('/pr/outlets/find-rss/sweep', { limit: 60 });
      const missing = await api.post('/pr/outlets/resolve-websites/sweep', { limit: 20 });
      const feeds = (known.found || 0) + (missing.feeds || 0);
      say('feeds', `${feeds} feed${feeds === 1 ? '' : 's'} found this pass: ${known.found || 0} at publications `
        + `that already had a website, ${missing.feeds || 0} from ${missing.websites || 0} new websites `
        + `across ${missing.checked || 0} that had neither. Click again for another batch.`);
      toast(`${feeds} feed${feeds === 1 ? '' : 's'} found.`, feeds ? 'success' : 'info');
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(null); }
  }

  async function mineFeeds() {
    setBusy('mine');
    try {
      const r = await api.post('/pr/feeds/mine', {});
      const bits = [];
      if (r.queued) bits.push(`${r.queued} new journalist${r.queued === 1 ? '' : 's'} from ${r.outlets} feed${r.outlets === 1 ? '' : 's'}`);
      if (r.flagged) bits.push(`${r.flagged} flagged gone-quiet`);
      say('mine', bits.length
        ? `${bits.join(' · ')}. They are waiting on Database › Journalists, under Find new journalists.`
        : 'Feeds processed. Nothing new to review right now.');
      toast(bits.length ? bits.join(' · ') : 'Nothing new to review.', bits.length ? 'success' : 'info');
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(null); }
  }

  async function embedNow() {
    setBusy('embed');
    try {
      const r = await api.post('/pr/embeddings/backfill', {});
      if (r.skipped === 'no-key') {
        say('embed', 'No OpenAI key is set, so there is nothing to embed with. Settings › Connections › Generation.');
        toast('Add an OpenAI key to enable semantic matching.', 'info');
      } else {
        say('embed', r.embedded
          ? `${r.embedded} journalist profile${r.embedded === 1 ? '' : 's'} embedded. Run it again for the next batch.`
          : 'Everyone with a topic profile is already embedded.');
        toast('Embedding run finished.', 'success');
      }
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(null); }
  }

  async function sendDigest() {
    setBusy('digest');
    try {
      const r = await api.post('/pr/digest/send-now', {});
      if (r.sent) say('digest', `Emailed. ${r.counts.total} item${r.counts.total === 1 ? '' : 's'} this week.`);
      else if (!r.counts?.total) say('digest', 'Nothing to review this week, so nothing was sent.');
      else say('digest', 'The digest was built, but no alert address is configured to send it to.');
      toast(r.sent ? 'Digest emailed.' : 'Nothing sent.', r.sent ? 'success' : 'info');
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(null); }
  }

  return (
    <div className="stack stack-lg">
      <p className="body-sm text-muted" style={{ margin: 0, maxWidth: 720, lineHeight: 1.6 }}>
        Jobs that act on the whole media database rather than on one record. Most of them run on their
        own overnight; the buttons here are for when you do not want to wait.
      </p>

      <Tool
        title="🔎 Find websites + feeds"
        note="Finds the RSS feed for any publication that already has a website, and searches for both
              the website and the feed for any that has neither. It runs over every publication, not a
              selection, which is the thing nobody could tell from looking at it."
        schedule="Runs nightly. One batch per click: 60 with a website, 20 without."
        result={results.feeds}
      >
        <button className="btn btn-secondary btn-sm"
          {...roWrite(readOnly, { onClick: findFeeds, disabled: !!busy })}>
          {busy === 'feeds' ? 'Finding…' : 'Find websites + feeds'}
        </button>
      </Tool>

      <Tool
        title="🛰 Mine feeds for new bylines"
        note="Reads every publication's feed, turns bylines you do not have into review suggestions, and
              flags journalists who have gone quiet. Nothing is added to the database until you approve it."
        schedule="Runs nightly."
        result={results.mine}
      >
        <Link to={JOURNALISTS} className="btn btn-secondary btn-sm">Review queue</Link>
        <button className="btn btn-secondary btn-sm"
          {...roWrite(readOnly, { onClick: mineFeeds, disabled: !!busy })}>
          {busy === 'mine' ? 'Mining…' : 'Mine feeds now'}
        </button>
      </Tool>

      <Tool
        title="🧠 Enable semantic matching"
        note="Builds a meaning fingerprint for every journalist with a topic profile, so best-contacts can
              rank by what someone writes about rather than by keyword. Needs an OpenAI key."
        schedule="Runs nightly."
        result={results.embed}
      >
        <button className="btn btn-secondary btn-sm"
          {...roWrite(readOnly, { onClick: embedNow, disabled: !!busy })}>
          {busy === 'embed' ? 'Embedding…' : 'Embed now'}
        </button>
      </Tool>

      <Tool
        title="📬 Email me this week’s digest"
        note="New journalists, gone-quiet, duplicates, moves and bad emails, in one email, so none of this
              depends on remembering to open this page."
        schedule="Sent every Monday."
        result={results.digest}
      >
        <button className="btn btn-secondary btn-sm"
          {...roWrite(readOnly, { onClick: sendDigest, disabled: !!busy })}>
          {busy === 'digest' ? 'Sending…' : 'Send it now'}
        </button>
      </Tool>

      <TagTidyTool />
    </div>
  );
}
