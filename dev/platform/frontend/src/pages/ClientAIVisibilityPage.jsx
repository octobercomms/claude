// Legacy redirect: AI Visibility is now a tab inside the Organic suite.
// Any bookmark to /clients/:id/ai-visibility should land on the SEO
// page with the AI Visibility tab active.

import React from 'react';
import { Navigate, useParams } from 'react-router-dom';

export default function ClientAIVisibilityPage() {
  const { id } = useParams();
  return <Navigate to={`/clients/${id}/seo?tab=ai_visibility`} replace />;
}
