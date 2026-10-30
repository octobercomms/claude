import React from 'react';
import { Link } from 'react-router-dom';
import ProposalDocument, { PROPOSAL_CSS } from '../components/proposal/ProposalDocument';
import { SAMPLE_PROPOSAL } from '../components/proposal/sampleProposal';

// A whole proposal, filled in, for a practice that does not exist.
//
// It goes through the same ProposalDocument component the prospect sees, so this
// is the proposal rather than a picture of one: changing the design changes this
// page, and anything that reads badly here reads badly in a real one. Useful for
// judging reading length, for designing against, and for testing the print
// stylesheet without sending anything to anybody.
//
// No database row, no token, no tracking. Nothing here can be sent.

export default function ProposalSamplePage() {
  return (
    <div style={{ background: '#0d0d0d', minHeight: '100vh' }}>
      <style>{PROPOSAL_CSS}</style>
      <div className="no-print" style={{
        background: '#e7cd41', color: '#111', padding: '10px 20px', display: 'flex',
        gap: 16, alignItems: 'center', flexWrap: 'wrap', fontFamily: 'Brockmann, sans-serif',
        fontWeight: 700, fontSize: 13,
      }}>
        <span>Sample proposal. Thurloe Studio is invented, and nothing here can be sent.</span>
        <button className="btn" style={{ padding: '6px 16px', fontSize: 13 }} onClick={() => window.print()}>
          print it
        </button>
        <Link to="/settings/proposals" style={{ color: '#111', marginLeft: 'auto' }}>
          edit the method →
        </Link>
      </div>
      <ProposalDocument
        data={SAMPLE_PROPOSAL}
        acceptSlot={(
          <div className="box no-print" style={{ marginTop: 20, borderStyle: 'dashed' }}>
            <strong>The accept block sits here.</strong>
            <div style={{ marginTop: 6, color: 'var(--mut)', fontSize: 14 }}>
              Name, a tick to agree the terms, then straight to the GoCardless mandate for this
              level in this currency. Disabled on the sample. On paper it becomes a line of text,
              which you can see by printing this page.
            </div>
          </div>
        )}
      />
    </div>
  );
}
