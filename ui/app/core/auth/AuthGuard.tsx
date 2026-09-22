import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Button, Flex, Spinner, Text } from '@radix-ui/themes';
import { normalizeReturnTo } from './returnTo';

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [status, setStatus] = useState<'loading' | 'ok' | 'unauthenticated' | 'unavailable'>('loading');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');
    fetch('/api/v1/authenticated', { credentials: 'include', cache: 'no-store', signal: controller.signal })
      .then(res => {
        if (!controller.signal.aborted) {
          setStatus(res.status === 401 ? 'unauthenticated' : res.status === 200 ? 'ok' : 'unavailable');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus('unavailable');
      });
    return () => controller.abort();
  }, [location.pathname, attempt]);

  if (status === 'loading') return (
    <Flex align="center" justify="center" style={{ minHeight: '100vh' }}>
      <Spinner size="3" />
    </Flex>
  );

  if (status === 'unavailable') return (
    <Flex direction="column" gap="3" align="center" justify="center" style={{ minHeight: '100vh' }}>
      <Text>Unable to verify your session. Check your connection and try again.</Text>
      <Button onClick={() => setAttempt(value => value + 1)}>Try again</Button>
    </Flex>
  );

  if (status === 'unauthenticated') {
    const returnTo = normalizeReturnTo(location.pathname + location.search);
    window.location.href = `/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
    return null;
  }

  return <>{children}</>;
}
