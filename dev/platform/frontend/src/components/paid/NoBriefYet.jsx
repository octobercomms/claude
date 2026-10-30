import React from 'react';

// What a pipeline step says when there is no brief behind it.
//
// The steps stay clickable on purpose. Locking them would make the rail
// honest, but a greyed-out rail reads as broken software rather than as
// "nothing here yet", and you would have no way to see what the later steps
// even do before committing to a brief.
//
// So the step opens and explains itself. The old wording was "No brief
// selected — pick one on the Brief step", which implies briefs exist and you
// failed to choose one. On a client with none, that is a dead end describing
// a choice you cannot make.
//
//   what — what this step would show, so the trip is not wasted
//   onBack — back to the Brief step
export default function NoBriefYet({ what, onBack }) {
  return (
    <div className="card" style={{ padding: 'var(--s5)', maxWidth: 620 }}>
      <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text)', lineHeight: 1.6, marginBottom: 'var(--s3)' }}>
        <strong>Write a brief first.</strong>{' '}
        {what} Every step after the brief works on the batch it produced, so
        there is nothing here until one exists.
      </div>
      <button className="btn btn-primary" onClick={onBack}>Go to the brief</button>
    </div>
  );
}
