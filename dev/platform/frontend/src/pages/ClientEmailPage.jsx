import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../utils/api';
import PageShell from '../components/shells/PageShell';
import ClientOutreachPage from './ClientOutreachPage';
import { useScreen } from '../hooks/useScreen';

// Email, as a section rather than a row.
//
// "I think this needs some clearer description of what this does and what
// it's for. I'm not sure where to start and what I'm achieving here."
//
// Both halves of that were caused by the same thing. Convert > Email was one
// nav row hiding five screens behind a tab strip: Campaigns, Prospects,
// Tasks, Sending, Selective outreach. Nothing told you the five existed, so
// there was nowhere to start, and nothing said what any of them produced.
//
// The five are rows in the nav now, which answers "where am I". This page
// answers "what am I achieving" — one line per screen, in the shape the Paid
// Brief step uses, naming what comes out rather than what is on screen.
const WHAT_IT_PRODUCES = {
  campaigns: 'A sequence that goes out on its own: first email, then follow-ups on a delay, '
    + 'skipping anyone who has replied, bounced or unsubscribed. You end up with a list of who '
    + 'opened, who clicked and who answered.',
  contacts: 'The people this client is pitching, and where each one got to. Add them by hand, '
    + 'or let Selective outreach find them. A prospect here is a company you want to reach, not '
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

export default function ClientEmailPage() {
  const { id } = useParams();
  const [client, setClient] = useState(null);
  const [tab, setTab] = useScreen('email');

  useEffect(() => { api.get(`/clients/${id}`).then(setClient).catch(() => {}); }, [id]);

  return (
    <div className="suite-email">
      <PageShell title="Email" subtitle={client?.name}>
        {WHAT_IT_PRODUCES[tab] && (
          <p className="body text-muted" style={{ maxWidth: 660, margin: '0 0 var(--s4)', lineHeight: 1.6 }}>
            {WHAT_IT_PRODUCES[tab]}
          </p>
        )}
        {/* One component, five screens. It reads which one it is on from the
            path, the way SettingsPage already does for Database and Biz dev,
            so nothing here is a rewrite of a working page. */}
        <ClientOutreachPage embedded clientId={id} screen={tab} onScreen={setTab} />
      </PageShell>
    </div>
  );
}
