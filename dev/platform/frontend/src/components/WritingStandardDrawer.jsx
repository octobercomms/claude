import React from 'react';
import SideDrawer from './ui/SideDrawer';

// The October Human Writing Standard, as a drawer.
//
// The standard was a PDF download and nothing else, which teaches nobody
// anything: you do not read a 13-section document to remember why the page
// refuses to draft your prose. The rule and the division of labour are here,
// on screen, and the PDF is at the bottom for the whole thing.
//
// It lives in its own file because the button that opens it is no longer in
// the same component as the drawer. The trigger sat under the release title,
// inside the record being edited, which read as a property of that release
// rather than of how releases are written here. It is now in the page header
// beside Share, where the things you do to the screen live, and it shows on
// the Releases screen whether or not a record is open — the standard governs
// the next release as much as the one in front of you.
export default function WritingStandardDrawer({ open, onClose }) {
  return (
    <SideDrawer open={open} onClose={onClose}
      kicker="Earned" title="The October Human Writing Standard" width={620}>
        <div style={{ display: 'grid', gap: 'var(--s4)' }}>
          <div>
            <div className="h3" style={{ marginBottom: 'var(--s2)' }}>The rule</div>
            <p className="body-sm text-muted" style={{ margin: 0, lineHeight: 1.6 }}>
              Claude does everything except the prose. Research, angles, interview questions,
              fact chasing, structure, headline options, pitch variants, media lists and
              follow-ups are automated. The sentences of the release are written by a person,
              from a completed fact sheet.
            </p>
            <p className="body-sm text-muted" style={{ marginTop: 'var(--s2)', lineHeight: 1.6 }}>
              This is not a rule about detectors. The reason AI-written releases fail is the
              same reason they get flagged: nobody gathered the facts.
            </p>
          </div>

          <div>
            <div className="h3" style={{ marginBottom: 'var(--s2)' }}>Who does what</div>
            <table className="table">
              <thead><tr><th>Stage</th><th>Claude</th><th>You</th></tr></thead>
              <tbody>
                {[
                  ['Angle options', 'proposes', 'decides'],
                  ['Interview questions', 'writes', 'asks'],
                  ['Fact sheet', 'structures, flags gaps', 'fills'],
                  ['Prose', 'does not write', 'writes or dictates'],
                  ['Gap analysis', 'scores and highlights', 'acts on'],
                  ['Headlines', 'proposes 10', 'picks and rewrites'],
                  ['Pitch emails', 'drafts variants', 'personalises'],
                  ['Media list', 'builds and dedupes', 'approves'],
                ].map(([stage, claude, you]) => (
                  <tr key={stage}>
                    <td style={{ fontWeight: stage === 'Prose' ? 700 : 400 }}>{stage}</td>
                    <td className="text-muted">{claude}</td>
                    <td className="text-muted">{you}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <div className="h3" style={{ marginBottom: 'var(--s2)' }}>The six moves a release makes</div>
            <p className="body-sm text-muted" style={{ margin: '0 0 var(--s2)', lineHeight: 1.6 }}>
              Reverse-engineered from the Hollaway F51 release. Five of the six are facts,
              which is why no model can fill them.
            </p>
            <ol className="body-sm text-muted" style={{ margin: 0, paddingLeft: 'var(--s5)', lineHeight: 1.7 }}>
              <li>A hook phrase, lifted from a person</li>
              <li>Scope, with a superlative or a hard number</li>
              <li>Material, method and siting</li>
              <li>The impact on the place or the user</li>
              <li>The wider programme it belongs to</li>
              <li>Third-party proof</li>
            </ol>
          </div>

          <div>
            <div className="h3" style={{ marginBottom: 'var(--s2)' }}>Writing it</div>
            <p className="body-sm text-muted" style={{ margin: 0, lineHeight: 1.6 }}>
              Dictate it. Talk through the completed fact sheet into a voice note, then tidy
              the transcript. Speech produces uneven sentence length, abandoned clauses and
              afterthoughts with no effort, and it is faster than typing.
            </p>
          </div>

          <a className="btn btn-secondary" href="/api/pr/editorial-standard.pdf" target="_blank" rel="noreferrer">
            ↓ The full standard (PDF)
          </a>
        </div>
    </SideDrawer>
  );
}
