import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import OutletProfileBody from '../components/OutletProfileBody';

// Full-page publication card (deep-linkable route). The editable body is shared
// with the in-place ProfileModal — see components/OutletProfileBody.jsx.
export default function OutletProfilePage() {
  const { id } = useParams();
  const nav = useNavigate();
  return (
    <div className="suite-profile">
      <OutletProfileBody
        id={id}
        mode="page"
        onClose={() => nav(-1)}
        onDeleted={() => nav('/settings?tab=publications')}
      />
    </div>
  );
}
