import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Flex, Spinner } from '@radix-ui/themes';
import { normalizeReturnTo } from './returnTo';

const USER_URI = import.meta.env.VITE_USER_SERVER_URL;

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [status, setStatus] = useState<'loading' | 'ok' | 'unauthenticated'>('loading');

  useEffect(() => {
    fetch('/api/v1/authenticated', { credentials: 'include' })
      .then(res => setStatus(res.status === 401 ? 'unauthenticated' : 'ok'))
      .catch(() => setStatus('unauthenticated'));
  }, [location.pathname]);

  if (status === 'loading') return (
    <Flex align="center" justify="center" style={{ minHeight: '100vh' }}>
      <Spinner size="3" />
    </Flex>
  );

  if (status === 'unauthenticated') {
    const returnTo = normalizeReturnTo(location.pathname + location.search);
    window.location.href = `/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
    return null;
  }

  return <>{children}</>;
}
