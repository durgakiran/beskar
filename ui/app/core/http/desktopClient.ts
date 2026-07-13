import { isDesktop } from '../desktop/isDesktop';
// @ts-ignore
import { GetAccessToken } from '../../../wailsjs/beskar/desktop/auth/authservice';

const originalFetch = window.fetch;
const USER_API_BASE = import.meta.env.VITE_USER_SERVER_URL || 'http://localhost:8084';
const EDITOR_API_BASE = import.meta.env.VITE_EDITOR_SERVER_URL || 'http://localhost:8085';

export function setupDesktopClient() {
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    let urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    // Only intercept our backend API calls. Avoid intercepting Wails internal IPC fetches!
    const isBackendApi = urlStr.startsWith('/api') || 
                         urlStr.startsWith('/auth') || 
                         urlStr.startsWith(USER_API_BASE) || 
                         urlStr.startsWith(EDITOR_API_BASE);

    if (!isBackendApi) {
      return originalFetch(input, init);
    }

    // Prepend base URL for relative API calls
    if (urlStr.startsWith('/api') || urlStr.startsWith('/auth')) {
      let base = USER_API_BASE.replace(/\/+$/, '');
      if (base.endsWith('/api/v1') && urlStr.startsWith('/api/v1')) {
        urlStr = base + urlStr.slice(7);
      } else {
        urlStr = base + urlStr;
      }
    }

    const token = await GetAccessToken();
    const headers = new Headers(init?.headers);
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const newInit = { ...init, headers };

    console.log(`[Desktop API Interceptor] Fetching: ${urlStr} (Token Attached: ${!!token})`);

    try {
      const response = await (typeof input === 'object' && 'url' in input 
        ? originalFetch(new Request(urlStr, newInit)) 
        : originalFetch(urlStr, newInit));
      
      if (!response.ok) {
        console.error(`[Desktop API Interceptor] Error ${response.status} from ${urlStr}`);
      }
      return response;
    } catch (err) {
      console.error(`[Desktop API Interceptor] Fetch failed for ${urlStr}:`, err);
      throw err;
    }
  };
}
