import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../utils/api';
import PageShell from '../components/shells/PageShell';
import PillarMeasure from '../components/PillarMeasure';
import ClarityCroPanel from '../components/ClarityCroPanel';
import FormsTab from '../components/FormsTab';
import ClientOutreachPage from './ClientOutreachPage';
import { useScreen } from '../hooks/useScreen';

// Convert — turning a visitor into a lead, and a lead into a reply.
//
// CRO, Forms and Email were group tabs inside Owned. Taxonomically that was
// right: traffic you own, converted on pages you own. Practically Owned had
// 29 SEO destinations and three more that had nothing to do with ranking, and
// the SEO work had no room to grow. These three are a different job on a
// different clock, so they get their own section beside the pillars.
//
// Sitting next to Paid/Earned/Shared/Owned without a chip, like Produce: the
// four pillars carry a chip because PESO needs translating, and these two do
// not because their names already say what they are.

// What each Outreach screen produces, in the shape the Paid Brief step uses:
// what comes out of it, not what is on it. The five were behind a tab strip
// with nothing saying where to start or what any of them achieved; the rows
// answer the first and these answer the second.
// The five screens Convert hands to ClientOutreachPage, named rather than
// derived from the map below: the panel's rows, this list and the page's
// branches have to agree, and routeTargets reads this to prove it.
const OUTREACH_SCREENS = ['campaigns', 'contacts', 'tasks', 'sending', 'prospecting'];

const OUTREACH_PRODUCES = {
  campaigns: 'A sequence that goes out on its own: first email, then follow-ups on a delay, '
    + 'skipping anyone who has replied, bounced or unsubscribed. You end up with a list of who '
    + 'opened, who clicked and who answered.',
  contacts: 'The people this client is pitching, and where each one got to. Add them by hand, '
    + 'or let Find leads find them. A prospect here is a company you want to reach, not '
    + 'a journalist and not one of October’s own leads.',
  tasks: 'What needs a person rather than a sequence: a reply to answer, a bounce to clean up, '
    + 'a thread to pick up. Cleared from here, so nothing sits unanswered because it was only '
    + 'ever visible in an inbox.',
  sending: 'Whether the mail can actually leave: the mailbox, its authentication, the daily cap '
    + 'and what has gone out today. Check it here before a campaign, not after a campaign has '
    + 'quietly failed.',
  prospecting: 'A list of companies worth approaching, built from a brief rather than a scrape, '
    + 'with the reasoning kept beside each one so you can dismiss the wrong ones and keep the '
    + 'rest. Nothing is contacted from here.',
};

export default function ClientConvertPage() {
  const { id } = useParams();
  const [client, setClient] = useState(null);
  const [connectors, setConnectors] = useState([]);
  const [tab, setTab] = useScreen('convert');
  const outreach = OUTREACH_SCREENS.includes(tab);

  useEffect(() => {
    api.get(`/clients/${id}`).then(setClient).catch(() => {});
    // Forms needs the October Forms connector to know where to send a lead.
    api.get(`/connectors/client/${id}`)
      .then(r => setConnectors(Array.isArray(r) ? r : (r.connectors || [])))
      .catch(() => {});
  }, [id]);

  return (
    <div className="suite-convert">
      <PageShell title="Convert" subtitle={client?.name}>
        {/* What this work actually drove. Same three headline numbers as the
            pillars, filtered to the channels that bring a lead in. */}
        <PillarMeasure clientId={id} pillar="owned" />

        {tab === 'cro' && <ClarityCroPanel clientId={id} />}
        {tab === 'forms' && <FormsTab clientId={id} connectors={connectors} />}

        {outreach && (
          <>
            <p className="body text-muted" style={{ maxWidth: 660, margin: '0 0 var(--s4)', lineHeight: 1.6 }}>
              {OUTREACH_PRODUCES[tab]}
            </p>
            {/* One component, five screens. It reads which one it is on from
                the path, the way SettingsPage already does for Database and
                Biz dev, so nothing here is a rewrite of a working page. */}
            <ClientOutreachPage embedded clientId={id} screen={tab} onScreen={setTab} />
          </>
        )}
      </PageShell>
    </div>
  );
}
