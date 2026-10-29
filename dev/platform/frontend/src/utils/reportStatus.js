// How a report's status is written and coloured, in one place.
//
// The statuses are database values (reportService writes them verbatim), and
// two of them are not something to put in front of a person: the longest,
// 'skipped_no_recipients', was rendering raw in a client card badge, where it
// was wider than the card's whole value column and pushed "Last report" onto
// two lines.
//
// Tone is deliberate as well as cosmetic. A skipped report is not a failure —
// nothing broke, the client simply has no recipients configured — so it reads
// grey, not red. It is also not a success, so it never reads green: a sent
// report and a binned one looked identical before this status existed, which
// is the mistake it was added to prevent.

export const REPORT_STATUS = {
  pending: { label: 'Pending', tone: 'neutral', color: 'var(--text-subtle)' },
  generating: { label: 'Generating', tone: 'warning', color: 'var(--warning)' },
  generated: { label: 'Generated', tone: 'accent', color: 'var(--accent)' },
  sending: { label: 'Sending', tone: 'warning', color: 'var(--warning)' },
  sent: { label: 'Sent', tone: 'success', color: 'var(--positive)' },
  failed: { label: 'Failed', tone: 'danger', color: 'var(--negative)' },
  skipped_no_recipients: { label: 'Not sent', tone: 'neutral', color: 'var(--text-subtle)' },
};

// Every status a report can hold, for filter lists. Kept as the map's own keys
// so a status added to the map appears in the filter without a second edit —
// 'skipped_no_recipients' was missing from the Reports page filter, which made
// the one group worth looking at the one group you could not isolate.
export const REPORT_STATUSES = Object.keys(REPORT_STATUS);

export function reportStatusLabel(status) {
  return REPORT_STATUS[status]?.label || status || '—';
}

export function reportStatusTone(status) {
  return REPORT_STATUS[status]?.tone || 'neutral';
}

export function reportStatusColor(status) {
  return REPORT_STATUS[status]?.color || 'var(--text-subtle)';
}
