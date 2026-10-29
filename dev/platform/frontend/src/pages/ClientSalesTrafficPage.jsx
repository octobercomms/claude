import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../utils/api';
import PageShell from '../components/shells/PageShell';
import SuiteOverview from '../components/SuiteOverview';
import DataFlowMap from '../components/DataFlowMap';
import ClientChatPage from './ClientChatPage';
import { useTabParam } from '../hooks/useTabParam';
import { useAuth } from '../context/AuthContext';

const fmtMoney = n => '£' + Math.round(Number(n || 0)).toLocaleString('en-GB');

const pad = n => String(n).padStart(2, '0');
const isoLocal = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isoToday = () => isoLocal(new Date());
const isoDaysAgo = n => isoLocal(new Date(Date.now() - n * 86400000));

export default function ClientSalesTrafficPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  // "Analyse" is the agency's private AI chat/analysis history — the secret
  // sauce a client can't use and shouldn't see. Hide the tab for client
  // (read-only) logins, and if one deep-links to ?tab=analyst, fall back to
  // Overview so the panel never renders.
  const { readOnly } = useAuth();
  const scopeRef = useRef(null);
  // Measure moved to the client Dashboard and the Strategist moved to its
  // Strategy tab, both in Oct 2026. Old ?tab= deep links to either land on
  // Overview rather than a blank page, via useTabParam's allow-list.
  const [tab, setTab] = useTabParam('overview', ['overview', 'analyst']);
  const [client, setClient] = useState(null);
  const [data, setData] = useState(null);

  // A client login must never land on the private Analyse tab, even by
  // deep-link — bounce them to Overview.
  useEffect(() => { if (readOnly && tab === 'analyst') setTab('overview'); }, [readOnly, tab, setTab]);

  useEffect(() => { api.get(`/clients/${id}`).then(setClient).catch(() => {}); }, [id]);

  // A fixed 30-day pull, only to fill the three readouts on the Overview card.
  // The range picker and everything it drove moved to MeasurePanel with the
  // rest of Measure; this page no longer offers a choice of window, so it no
  // longer needs the state for one.
  useEffect(() => {
    api.get(`/sales-traffic/${id}?start=${isoDaysAgo(29)}&end=${isoToday()}`)
      .then(setData)
      .catch(err => setData({ error: err.message }));
  }, [id]);
  const k = (data && data.kpis) || {};

  return (
    <div className="suite-sales" ref={scopeRef}>
      <PageShell title="Data" subtitle={client?.name} tabs={[
        { key: 'overview',  label: 'Overview',     active: tab === 'overview',  onClick: () => setTab('overview') },
        // Analyse (the private AI chat) is agency-only.
        ...(readOnly ? [] : [{ key: 'analyst', label: 'Analyse', fn: 'research', active: tab === 'analyst', onClick: () => setTab('analyst') }]),
      ]}>

      {tab === 'analyst' && !readOnly && <ClientChatPage embedded clientId={id} />}

      {tab === 'overview' && (
        <SuiteOverview
          tagline="Stop building reports. Just ask."
          description="Live revenue, orders and traffic the second the page loads — and any question answered in plain English, with the numbers to back it up. The analyst who already knows the account."
          benefits={['Live revenue, orders & traffic', 'Answers in plain English', 'No report-building']}
          readouts={[
            { fn: 'measure', name: 'Revenue · 30d', value: fmtMoney(k.revenue || 0), sub: k.revenue ? 'live' : 'no data' },
            { fn: 'data',    name: 'Shopify', value: k.revenue ? 'Live' : '—', sub: k.revenue ? 'connected' : 'no data' },
            { fn: 'data',    name: 'GA4',     value: k.sessions ? 'Live' : '—', sub: k.sessions ? 'connected' : 'no data' },
          ]}
          primary={readOnly ? {
            fn: 'measure',
            kicker: 'The main job here',
            title: 'See the live numbers',
            description: 'Revenue, orders and traffic the second the page loads — no report-building.',
            ctaLabel: 'Open Measure',
            onCta: () => navigate(`/clients/${id}?tab=measure`),
          } : {
            fn: 'research',
            kicker: 'The main job here',
            title: 'Ask anything about the account',
            description: 'The analyst already knows the account. Ask in plain English and get the answer with the numbers to back it up.',
            ctaLabel: 'Open the analyst',
            onCta: () => setTab('analyst'),
          }}
          otherJobs={{ label: 'Other jobs in Data', items: readOnly ? [] : [
            { fn: 'measure', label: 'Measure — live KPIs, on the Dashboard', onClick: () => navigate(`/clients/${id}?tab=measure`) },
          ] }}
          diagram={<DataFlowMap onPerformance={() => navigate(`/clients/${id}?tab=measure`)} onAnalyst={readOnly ? undefined : () => setTab('analyst')} />}
        />
      )}

      </PageShell>
    </div>
  );
}

