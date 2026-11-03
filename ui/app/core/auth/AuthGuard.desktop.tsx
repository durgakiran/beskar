import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Flex, Spinner, Button, Heading, Text, Card } from '@radix-ui/themes';

// @ts-ignore
import { Events } from '@wailsio/runtime';
// @ts-ignore
import { GetStatus, IsAuthenticated, Login } from '../../../wailsjs/beskar/desktop/auth/uiauthservice';

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [status, setStatus] = useState<'loading' | 'ok' | 'unauthenticated'>('loading');

  const [authMessage, setAuthMessage] = useState('');
  const statusRevision = useRef(0);

  useEffect(() => {
    let active = true;
    const refreshStatus = async () => {
      const revision = ++statusRevision.current;
      try {
        const [authed, diagnostic] = await Promise.all([IsAuthenticated(), GetStatus()]);
        if (!active || revision !== statusRevision.current) return;
        setAuthMessage(diagnostic.message);
        setStatus(authed && !diagnostic.requiresSignIn ? 'ok' : 'unauthenticated');
      } catch {
        if (!active || revision !== statusRevision.current) return;
        setAuthMessage('Unable to read authentication status. Restart the app and try again.');
        setStatus('unauthenticated');
      }
    };
    const completedLogin = () => { setIsLoggingIn(false); void refreshStatus(); };
    const cancelReady = Events.On('auth:ready', completedLogin);
    const cancelLogout = Events.On('auth:logout', completedLogin);
    const cancelStatus = Events.On('auth:status', () => { void refreshStatus(); });
    void refreshStatus();
    return () => {
      active = false;
      cancelReady?.(); cancelLogout?.(); cancelStatus?.();
    };
  }, [location.pathname]);

  const pendingLogin = useRef<ReturnType<typeof Login> | null>(null);

  useEffect(() => () => {
    const request = pendingLogin.current;
    pendingLogin.current = null;
    void request?.cancel();
  }, []);

  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const handleLogin = () => {
    setIsLoggingIn(true);
    setLoginError(null);
    const request = Login();
    pendingLogin.current = request;
    request.then(() => {
      if (pendingLogin.current !== request) return;
      pendingLogin.current = null;
      setIsLoggingIn(false);
    }, err => {
      if (pendingLogin.current !== request) return;
      pendingLogin.current = null;
      setLoginError(String(err));
      setIsLoggingIn(false);
    });
  };

  const handleCancelLogin = () => {
    const request = pendingLogin.current;
    pendingLogin.current = null;
    void request?.cancel();
    setIsLoggingIn(false);
    setLoginError(null);
  };

  if (status === 'loading') return (
    <Flex align="center" justify="center" style={{ minHeight: '100vh' }}>
      <Spinner size="3" />
    </Flex>
  );

  if (status === 'unauthenticated') {
    return (
      <Flex align="center" justify="center" style={{ minHeight: '100vh', backgroundColor: 'var(--gray-2)' }}>
        <Card size="4" style={{ width: 400, textAlign: 'center' }}>
          <Flex direction="column" gap="4" align="center">
            <Heading size="6">Welcome to Teddox</Heading>
            <Text color="gray" size="2">
              Please sign in with your web browser to access your desktop workspace.
            </Text>
            
            <Button size="3" onClick={handleLogin} disabled={isLoggingIn} style={{ width: '100%', marginTop: '12px' }}>
              {isLoggingIn ? <><Spinner /> Waiting for browser...</> : "Sign In"}
            </Button>

            {isLoggingIn && <Button variant="soft" onClick={handleCancelLogin}>Cancel sign-in</Button>}

            {authMessage && <Text role="alert" color="red" size="2">{authMessage}</Text>}

            {loginError && (
              <Text color="red" size="2">
                Sign-in failed: {loginError}
              </Text>
            )}
          </Flex>
        </Card>
      </Flex>
    );
  }

  return <>
    {children}
    {authMessage && <div role="alert" style={{ position: 'fixed', bottom: 16, right: 16, maxWidth: 480, zIndex: 10000, padding: 16, border: '1px solid var(--amber-7)', borderRadius: 8, background: 'var(--amber-2)', color: 'var(--amber-12)', boxShadow: '0 2px 12px #0002' }}>{authMessage}</div>}
  </>;
}
