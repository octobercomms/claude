import React from 'react';
import { SECTIONS, slugForTab } from '../nav/sections';
import { useParams, useNavigate } from 'react-router-dom';
import JournalistProfileBody from '../components/JournalistProfileBody';

// Full-page journalist card (deep-linkable route). The editable body is shared
// with the in-place ProfileModal — see components/JournalistProfileBody.jsx.
export default function JournalistProfilePage() {
  const { id } = useParams();
  const nav = useNavigate();
  return (
    <div className="suite-profile">
      <JournalistProfileBody
        id={id}
        mode="page"
        onClose={() => nav(-1)}
        onDeleted={() => nav(`${SECTIONS.database.base()}/${slugForTab(SECTIONS.database, 'contacts')}`)}
      />
    </div>
  );
}
