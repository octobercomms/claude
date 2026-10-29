// Which clients a scheduled report would reach, and which it would not.
//
// The nine-of-ten problem was invisible because the only recipients check in
// the product was one line on one client's Setup tab. You could not see across
// the book, so a client silently receiving nothing looked exactly like a client
// being served. This is that view.
//
// Weekly is listed first and treated as the default obligation because
// runScheduledReports defaults weekly_day to Monday: an active client with an
// empty report_schedule is due a weekly report whether or not anyone chose it.

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';

export default function ReportDelivery() {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    api.get('/reports/delivery')
      .then(r => setRows(r.clients || []))
      .catch(() => setRows([]));
  }, []);

  if (!rows) return null;

  const missing = rows.filter(c => !c.weekly.recipients);
  const monthlyGaps = rows.filter(c => c.monthly.scheduled && !c.monthly.recipients);

  if (!missing.length && !monthlyGaps.length) {
    return (
      <div className="card mb-s5">
        <strong className="text-positive">Every active client has report recipients.</strong>{' '}
        <span className="text-subtle">{rows.length} client{rows.length === 1 ? '' : 's'} checked.</span>
      </div>
    );
  }

  return (
    <div className="card mb-s5">
      <h3 className="h3 mb-2">Clients receiving nothing</h3>
      <p className="text-subtle" style={{ fontSize: 'var(--fs-body)', marginBottom: 'var(--s4)' }}>
        A weekly report is due every Monday for every active client unless a different day is set.
        {' '}
        <strong className="text-ink">
          {missing.length} of {rows.length}
        </strong>{' '}
        {missing.length === 1 ? 'has' : 'have'} no weekly recipients, so the scheduler records the
        report as not sent and skips building it. Nothing is being spent on them, and nothing is
        arriving either.
      </p>

      <table className="table">
        <thead>
          <tr>{['Client', 'Weekly', 'Monthly', ''].map(h => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map(c => (
            <tr key={c.id} style={{ opacity: c.weekly.recipients ? 0.55 : 1 }}>
              <td><strong>{c.name}</strong></td>
              <td><Recipients n={c.weekly.recipients} scheduled={c.weekly.scheduled} /></td>
              <td><Recipients n={c.monthly.recipients} scheduled={c.monthly.scheduled} /></td>
              <td className="num">
                {!c.weekly.recipients && (
                  <Link to={`/clients/${c.id}?tab=details`} className="text-ink underline" style={{ fontWeight: 600 }}>
                    Add recipients →
                  </Link>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Recipients({ n, scheduled }) {
  if (!scheduled) return <span className="text-subtle" style={{ fontSize: 'var(--fs-caption)' }}>not scheduled</span>;
  if (!n) return <span className="chip chip-warning">none</span>;
  return <span className="text-ink font-semibold">{n} recipient{n === 1 ? '' : 's'}</span>;
}
