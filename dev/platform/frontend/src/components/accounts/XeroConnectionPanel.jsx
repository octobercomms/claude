import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../../utils/api';
import { useToast } from '../../context/ToastContext';

export default function XeroConnectionPanel() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const { toast } = useToast();

  const load = useCallback(() => {
    setLoading(true);
    api.get('/accounts/xero/status')
      .then(setStatus)
      .catch(() => toast('Failed to check Xero status', 'error'))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const connect = () => {
    api.get('/accounts/xero/auth-url')
      .then(r => { window.location.href = r.url; })
      .catch(e => toast(e.message || 'Failed to start Xero auth', 'error'));
  };

  const disconnect = () => {
    if (!window.confirm('Disconnect Xero? You will need to re-authorise to use the accounts module.')) return;
    setDisconnecting(true);
    api.post('/accounts/xero/disconnect')
      .then(() => { toast('Xero disconnected', 'success'); load(); })
      .catch(e => toast(e.message || 'Disconnect failed', 'error'))
      .finally(() => setDisconnecting(false));
  };

  if (loading) return <div className="card"><h2 className="caption">Xero connection</h2><p className="body-sm text-muted">Checking…</p></div>;

  const connected = status?.connected;

  return (
    <div className="card">
      <div className="row between center" style={{ marginBottom: 'var(--s3)' }}>
        <div>
          <h2 className="caption">Xero connection</h2>
          <p className="body-sm text-muted">
            OAuth2 connection to your Xero organisation. Required for pulling transactions and attaching invoices.
          </p>
        </div>
        <span className={`chip ${connected ? 'chip-success' : 'chip-danger'}`}>
          {connected ? 'Connected' : 'Not connected'}
        </span>
      </div>

      {connected && (
        <div style={{ marginBottom: 'var(--s3)' }}>
          <div style={{ display: 'flex', gap: 'var(--s5)', flexWrap: 'wrap' }}>
            {status.org_name && (
              <div>
                <div className="body-sm text-subtle" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>Organisation</div>
                <div style={{ fontWeight: 700 }}>{status.org_name}</div>
              </div>
            )}
            {status.connected_at && (
              <div>
                <div className="body-sm text-subtle" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>Connected</div>
                <div style={{ fontWeight: 700 }}>{new Date(status.connected_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
              </div>
            )}
            {status.token_expires_at && (
              <div>
                <div className="body-sm text-subtle" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>Token expires</div>
                <div style={{ fontWeight: 700 }}>{new Date(status.token_expires_at).toLocaleString('en-GB')}</div>
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 'var(--s2)' }}>
        {!connected && (
          <button className="btn btn-primary" onClick={connect}>
            Connect Xero
          </button>
        )}
        {connected && (
          <>
            <button className="btn btn-primary" onClick={connect}>
              Re-authorise
            </button>
            <button className="btn btn-danger" onClick={disconnect} disabled={disconnecting}>
              {disconnecting ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
