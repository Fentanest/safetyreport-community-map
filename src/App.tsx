import { useEffect } from 'react';
import AccessGate from './components/AccessGate';
import { viewerKey } from './auth/mapAuth';
import { exportController } from './export/controller';
import { dataMode } from './data/client';
import { useMapAuth } from './hooks/usePersonal';
import Dashboard from './pages/Dashboard';

export default function App() {
  const { auth, signIn, signOut } = useMapAuth();
  // F06: the Excel job belongs to one account. Set here (not in Dashboard): signing out unmounts the dashboard, and a
  // running export must still be cancelled and a finished file (with its save button) dropped.
  const account = auth.status === 'loading' ? null : `${auth.status}|${auth.status === 'signed_in' ? viewerKey(auth.viewerId) : 'none'}`;
  useEffect(() => { if (account !== null) exportController.setViewer(account); }, [account]);

  if (dataMode === 'live' && auth.status !== 'signed_in') {
    return <AccessGate code="auth_required" auth={auth} onSignIn={signIn} onSignOut={signOut} onRetry={signIn} />;
  }
  return <Dashboard />;
}
