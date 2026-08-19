import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Flex, Spinner, Button, Heading, Text, Card } from '@radix-ui/themes';

// @ts-ignore
import { Events } from '@wailsio/runtime';
// @ts-ignore
import { IsAuthenticated, Login } from '../../../wailsjs/beskar/desktop/auth/authservice';

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [status, setStatus] = useState<'loading' | 'ok' | 'unauthenticated'>('loading');

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const authed = await IsAuthenticated();
        if (authed) {
          setStatus('ok');
        } else {
          setStatus('unauthenticated');
        }
      } catch (err) {
        setStatus('unauthenticated');
      }
    };
    checkAuth();
  }, [location.pathname]);

  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  useEffect(() => {
    const cancelReady = Events.On('auth:ready', () => {
      setStatus('ok');
      setIsLoggingIn(false);
    });
    const cancelLogout = Events.On('auth:logout', () => {
      setStatus('unauthenticated');
      setIsLoggingIn(false);
    });
    
    return () => {
      if (cancelReady) cancelReady();
      if (cancelLogout) cancelLogout();
    };
  }, []);

  const handleLogin = () => {
    setIsLoggingIn(true);
    setLoginError(null);
    Login().catch(err => {
      console.error("Login failed:", err);
      setLoginError(String(err));
      setIsLoggingIn(false);
    });
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

            {loginError && (
              <Text color="red" size="2">
                Error launching browser: {loginError}
              </Text>
            )}
          </Flex>
        </Card>
      </Flex>
    );
  }

  return <>{children}</>;
}
