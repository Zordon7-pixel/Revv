import React from 'react';
import { AlertTriangle, Wrench } from 'lucide-react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('[REVV Error]', error, info);
    import('../lib/sentry').then(({ captureException }) => captureException(error, { extra: { componentStack: (info?.componentStack || '').slice(0, 600) } })).catch(() => {});
    // Auto-report React render errors to feedback
    try {
      const payload = {
        app: 'revv',
        tester_name: 'Auto-Reporter',
        category: 'bug',
        priority: 'high',
        message: `[AUTO] React render crash: ${error?.message || 'Unknown'}`,
        expected: 'No crash',
        actual: error?.message || String(error),
        context: JSON.stringify({
          url: window.location.href,
          componentStack: (info?.componentStack || '').slice(0, 600),
          stack: (error?.stack || '').slice(0, 500),
          timestamp: new Date().toISOString(),
        }),
      };
      // Use raw fetch so we don't import api here (class component)
      const token = window.localStorage.getItem('sc_token');
      fetch('/api/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      }).catch(() => {});
    } catch (_) {}
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-void p-8 font-body text-ink">
          <AlertTriangle size={48} className="text-crit" />
          <h1 className="m-0 font-display text-[22px] font-bold">Something went wrong</h1>
          <p className="m-0 max-w-md text-center text-sm text-muted">
            REVV ran into an unexpected error. Click below to attempt an automatic repair and reload.
          </p>
          <p className="max-w-lg break-all rounded-lg border border-line-2 bg-panel px-4 py-2 font-mono text-xs text-faint">
            {this.state.error?.message || 'Unknown error'}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="flex items-center gap-2 rounded-lg bg-brand px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-lit"
          >
            <Wrench size={14} /> Repair &amp; Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
