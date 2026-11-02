import { buildAuthLoginUrl } from './returnTo';

export function redirectToLogin(returnTo?: string) {
    window.location.href = buildAuthLoginUrl(returnTo ?? (
        window.location.pathname + window.location.search + window.location.hash
    ));
}
