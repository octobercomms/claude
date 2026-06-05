// Legacy redirect: Audiences is now a tab inside the Paid suite. Any
// bookmark to /clients/:id/audiences should land on the Ads page with
// the Audiences tab active.

import React from 'react';
import { Navigate, useParams } from 'react-router-dom';

export default function ClientAudiencesPage() {
  const { id } = useParams();
  return <Navigate to={`/clients/${id}/ads?tab=audiences`} replace />;
}
