// The Design page, mounted for real.
//
// Nothing is stubbed here: the real providers, the real router, the real api
// helper. The network is intercepted in the browser by smoke.mjs, so what
// runs is the page as shipped. That is the point — the two crashes this
// exists to catch (a dependency array naming a const declared below it, and
// anything that throws on the way to first paint) both passed vite build and
// the hooks lint, because nothing in CI ever rendered the thing.

import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../src/context/AuthContext';
import { ToastProvider } from '../../src/context/ToastContext';
import ClientDesignPage from '../../src/pages/ClientDesignPage';
import '../../src/index.css';

const CLIENT = '11111111-1111-4111-8111-111111111111';

createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={[`/clients/${CLIENT}/video?tab=design`]}>
    <AuthProvider>
      <ToastProvider>
        <ClientDesignPage embedded clientId={CLIENT} />
      </ToastProvider>
    </AuthProvider>
  </MemoryRouter>,
);
