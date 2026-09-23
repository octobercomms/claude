import React from 'react';

// ChatCanvas (L6) — converse on the left, watch the artifact build on the
// right. One shell for the report-template builder and the social planner.
// Layout only; parent supplies the chat and canvas nodes.
//   fill — a flex row that fills its parent's height (chat wider than canvas),
//          for the AI-builder modals; the panes carry their own flex ratios.
//          The default is a balanced page-level grid (canvas slightly wider).
export default function ChatCanvas({ chat, canvas, fill = false }) {
  return (
    <div className={fill ? 'ds-chatcanvas--fill' : 'ds-chatcanvas'}>
      {chat}
      {canvas}
    </div>
  );
}
