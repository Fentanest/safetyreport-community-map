import { useEffect, useLayoutEffect } from 'react';
import { initialTheme, resolveTheme } from './lib/theme';
import AccessGate from './components/AccessGate';
import { viewerKey } from './auth/mapAuth';
import { exportController } from './export/controller';
import { dataMode } from './data/client';
import { useMapAuth } from './hooks/usePersonal';
import Dashboard from './pages/Dashboard';
import { ClientUpdateContext } from './components/ClientUpdateNotice';
import { useClientUpdate } from './hooks/useClientUpdate';
import UpdateRequired from './components/UpdateRequired';

export default function App() {
  const { auth, signIn, signOut } = useMapAuth();
  const clientUpdate = useClientUpdate(auth);
  // F06: the Excel job belongs to one account. Set here (not in Dashboard): signing out unmounts the dashboard, and a
  // running export must still be cancelled and a finished file (with its save button) dropped.
  const account = auth.status === 'loading' ? null : `${auth.status}|${auth.status === 'signed_in' ? viewerKey(auth.viewerId) : 'none'}`;
  useEffect(() => { if (account !== null) exportController.setViewer(account); }, [account]);

  // AccessGate can render before Dashboard mounts. Apply the same stored/system theme before paint.
  useLayoutEffect(() => {
    if (auth.status === 'signed_in') return;
    const theme = initialTheme();
    const apply = () => { document.documentElement.dataset.theme = resolveTheme(theme); };
    apply();
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [auth.status]);

  if (dataMode === 'live' && auth.status !== 'signed_in') {
    return <AccessGate code="auth_required" auth={auth} onSignIn={signIn} onSignOut={signOut} onRetry={signIn} />;
  }
  // 2-10 (2026-10-22): the server says no app of this account meets the required version → update screen, not the map.
  // Only an explicit `blocked: true` answer locks; a failed or pending client-status keeps the map open.
  const gate = clientUpdate.status?.update_gate;
  if (gate?.blocked) {
    return <UpdateRequired gate={gate} displayName={auth.displayName ?? null} onRetry={clientUpdate.refresh} onSignOut={signOut} />;
  }
  return <ClientUpdateContext.Provider value={clientUpdate}><Dashboard /></ClientUpdateContext.Provider>;
}
