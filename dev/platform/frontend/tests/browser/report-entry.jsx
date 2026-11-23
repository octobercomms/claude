// The report review screen, mounted for real.
//
// Nothing is stubbed in here: the real providers, the real router, the real
// api helper. The network is intercepted in the browser by report.mjs, so what
// runs is the page as shipped.
//
// That is the point. Three defects in this screen passed `vite build` and the
// lint and were only visible once something rendered it: a revert control
// positioned on top of the neighbouring metric cell, a sentence inside a
// metric cell that doubled the cell's height and shoved the grid around, and
// an edited-state marker drawn as the same yellow rule a comment carries, so
// one mark meant two things side by side.

import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '../../src/context/AuthContext';
import { ToastProvider } from '../../src/context/ToastContext';
import { PromptProvider } from '../../src/context/PromptContext';
import { FeatureCostProvider } from '../../src/components/FeatureCost';
import ReportReviewPage from '../../src/pages/ReportReviewPage';
import '../../src/index.css';

const CLIENT = '11111111-1111-4111-8111-111111111111';
const REPORT = 'rrrrrrrr-1111-4111-8111-111111111111';

createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={[`/clients/${CLIENT}/reports/${REPORT}`]}>
    <AuthProvider>
      <ToastProvider>
        <PromptProvider>
          <FeatureCostProvider>
            <Routes>
              {/* useParams reads both ids, so the page has to be mounted
                  under its real path rather than rendered directly. */}
              <Route path="/clients/:id/reports/:reportId" element={<ReportReviewPage />} />
            </Routes>
          </FeatureCostProvider>
        </PromptProvider>
      </ToastProvider>
    </AuthProvider>
  </MemoryRouter>,
);
