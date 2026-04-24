export interface EmbedProviderMatch {
  provider: string;
  providerName: string;
  embedUrl: string;
}

interface EmbedProvider {
  id: string;
  name: string;
  regex: RegExp;
  getEmbedUrl: (url: URL, match: RegExpMatchArray) => string;
  getTitleUrl?: (url: URL) => string;
}

function withHttps(url: URL, pathname: string, search = ''): string {
  return `https://${url.hostname}${pathname}${search}`;
}

export const EMBED_PROVIDERS: EmbedProvider[] = [
  {
    id: 'youtube',
    name: 'YouTube',
    regex: /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/,
    getEmbedUrl: (_url, match) => `https://www.youtube-nocookie.com/embed/${match[1]}`,
    getTitleUrl: (url) => `https://www.youtube.com/oembed?url=${encodeURIComponent(url.href)}&format=json`,
  },
  {
    id: 'vimeo',
    name: 'Vimeo',
    regex: /vimeo\.com\/(?:video\/)?(\d+)/,
    getEmbedUrl: (_url, match) => `https://player.vimeo.com/video/${match[1]}`,
    getTitleUrl: (url) => `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url.href)}`,
  },
  {
    id: 'loom',
    name: 'Loom',
    regex: /loom\.com\/(?:share|embed)\/([A-Za-z0-9]+)/,
    getEmbedUrl: (_url, match) => `https://www.loom.com/embed/${match[1]}`,
    getTitleUrl: (url) => `https://www.loom.com/v1/oembed?url=${encodeURIComponent(url.href)}`,
  },
  {
    id: 'figma',
    name: 'Figma',
    regex: /figma\.com\/(?:file|design|proto|board)\//,
    getEmbedUrl: (_url, match) => `https://www.figma.com/embed?embed_host=beskar&url=${encodeURIComponent(match.input ?? '')}`,
    getTitleUrl: (url) => `https://www.figma.com/oembed?url=${encodeURIComponent(url.href)}`,
  },
  {
    id: 'miro',
    name: 'Miro',
    regex: /miro\.com\/app\/board\/([^/?#]+)/,
    getEmbedUrl: (_url, match) => `https://miro.com/app/live-embed/${match[1]}/`,
    getTitleUrl: (url) => `https://miro.com/oembed?url=${encodeURIComponent(url.href)}`,
  },
  {
    id: 'drawio',
    name: 'Draw.io',
    regex: /(?:app\.diagrams\.net|embed\.diagrams\.net|draw\.io)/,
    getEmbedUrl: (url) => url.href,
  },
  {
    id: 'excalidraw',
    name: 'Excalidraw',
    regex: /excalidraw\.com\//,
    getEmbedUrl: (url) => url.href,
  },
  {
    id: 'framer',
    name: 'Framer',
    regex: /framer\.com\//,
    getEmbedUrl: (url) => url.href,
  },
  {
    id: 'airtable',
    name: 'Airtable',
    regex: /airtable\.com\/(?:embed\/)?(.+)/,
    getEmbedUrl: (url) => {
      if (url.pathname.startsWith('/embed/')) return url.href;
      return withHttps(url, `/embed${url.pathname}`, url.search);
    },
  },
  {
    id: 'typeform',
    name: 'Typeform',
    regex: /(?:typeform\.com|form\.typeform\.com)\//,
    getEmbedUrl: (url) => url.href,
  },
  {
    id: 'gdrive',
    name: 'Google Drive',
    regex: /drive\.google\.com\/file\/d\/([^/]+)/,
    getEmbedUrl: (_url, match) => `https://drive.google.com/file/d/${match[1]}/preview`,
  },
  {
    id: 'gsheets',
    name: 'Google Sheets',
    regex: /docs\.google\.com\/spreadsheets\/d\/([^/]+)/,
    getEmbedUrl: (_url, match) => `https://docs.google.com/spreadsheets/d/${match[1]}/preview`,
  },
];

export function parseHttpsUrl(rawUrl: string): URL | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

export function getProviderName(providerId: string): string {
  return EMBED_PROVIDERS.find((provider) => provider.id === providerId)?.name || 'Embed';
}

async function fetchEmbedTitle(endpoint: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(endpoint, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });
    if (!response.ok) return null;

    const payload = await response.json() as { title?: unknown };
    return typeof payload.title === 'string' && payload.title.trim() ? payload.title.trim() : null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}

export function getEmbedUrlAndProvider(rawUrl: string): EmbedProviderMatch | null {
  const url = parseHttpsUrl(rawUrl);
  if (!url) return null;

  for (const provider of EMBED_PROVIDERS) {
    const match = url.href.match(provider.regex);
    if (!match) continue;

    const embedUrl = provider.getEmbedUrl(url, match);
    const safeEmbedUrl = parseHttpsUrl(embedUrl);
    if (!safeEmbedUrl) return null;

    return {
      provider: provider.id,
      providerName: provider.name,
      embedUrl: safeEmbedUrl.href,
    };
  }

  return null;
}

export function isSinglePlainUrl(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && !/\s/.test(trimmed) && parseHttpsUrl(trimmed) !== null;
}

export async function resolveEmbedTitle(rawUrl: string, providerId?: string): Promise<string | null> {
  const url = parseHttpsUrl(rawUrl);
  if (!url) return null;

  const provider = providerId
    ? EMBED_PROVIDERS.find((candidate) => candidate.id === providerId)
    : EMBED_PROVIDERS.find((candidate) => candidate.regex.test(url.href));

  const candidateEndpoints = [
    provider?.getTitleUrl?.(url),
    `https://noembed.com/embed?url=${encodeURIComponent(url.href)}`,
  ].filter((value): value is string => Boolean(value));

  for (const endpoint of candidateEndpoints) {
    const title = await fetchEmbedTitle(endpoint);
    if (title) return title;
  }

  return null;
}
