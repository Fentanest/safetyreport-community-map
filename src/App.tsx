import { useEffect, useRef } from 'react';
import AccessGate from './components/AccessGate';
import { dataMode } from './data/client';
import { useMapAuth } from './hooks/usePersonal';
import Dashboard from './pages/Dashboard';

export default function App() {
  const { auth, signIn, signOut } = useMapAuth();
  const startedLogin = useRef(false);

  useEffect(() => {
    if (auth.status === 'signed_in') startedLogin.current = false;
    if (dataMode !== 'live' || auth.status !== 'signed_out' || startedLogin.current) return;
    startedLogin.current = true;
    signIn();
  }, [auth.status, signIn]);

  if (dataMode === 'live' && auth.status !== 'signed_in') {
    return <AccessGate code="auth_required" auth={auth} onSignIn={signIn} onSignOut={signOut} onRetry={signIn} />;
  }
  return <Dashboard />;
}
