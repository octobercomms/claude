import React from 'react';

// ChatCanvas (L6) — converse on the left, watch the artifact build on the
// right. One shell for the report-template builder and the social planner.
// Layout only; parent supplies the chat and canvas nodes.
export default function ChatCanvas({ chat, canvas }) {
  return (
    <div className="ds-chatcanvas">
      {chat}
      {canvas}
    </div>
  );
}
