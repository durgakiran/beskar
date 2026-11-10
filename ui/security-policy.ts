import type { Plugin } from 'vite';

// External frames are separate origins and sandboxed by the editor. Never add
// 'self', arbitrary https:, or the native loopback bridge to frame-src.
const frames = [
  'https://www.youtube-nocookie.com', 'https://player.vimeo.com',
  'https://www.loom.com', 'https://www.figma.com', 'https://miro.com',
  'https://app.diagrams.net', 'https://embed.diagrams.net', 'https://draw.io',
  'https://www.draw.io', 'https://excalidraw.com', 'https://framer.com',
  'https://www.framer.com', 'https://airtable.com', 'https://www.airtable.com',
  'https://typeform.com', 'https://www.typeform.com', 'https://form.typeform.com',
  'https://drive.google.com', 'https://docs.google.com',
];
const metadata = ['https://www.youtube.com', 'https://vimeo.com', 'https://www.loom.com',
  'https://www.figma.com', 'https://miro.com', 'https://noembed.com'];

export function contentSecurityPolicy(desktop: boolean, env: Record<string, string> = {}) {
  const connections = new Set(["'self'", ...metadata]);
  for (const name of ['VITE_USER_SERVER_URL', 'VITE_EDITOR_SERVER_URL', 'VITE_IMAGE_SERVER_URL',
    'VITE_API_BASE_URL', 'VITE_API_URL', 'VITE_SIGNALING_URL', 'VITE_COLLAB_URL']) {
    const value = env[name];
    if (!value || value.startsWith('/')) continue;
    const url = new URL(value);
    if (!['https:', 'wss:', 'http:', 'ws:'].includes(url.protocol) || url.username || url.password)
      throw new Error(`Invalid ${name} for CSP`);
    connections.add(url.origin);
    if (name === 'VITE_USER_SERVER_URL') connections.add(url.origin.replace(/^http/, 'ws'));
  }
  // The native asset middleware adds a second policy restricted to the actual
  // process port. This static allowance cannot grant access to another port.
  if (desktop) {
    connections.add('http://127.0.0.1:*');
    connections.add('ws://127.0.0.1:*');
  }
  return [
    "default-src 'none'", "script-src 'self' 'wasm-unsafe-eval'",
    "script-src-attr 'none'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com", "img-src 'self' https: data: blob:",
    "media-src 'self' https: blob:", `connect-src ${[...connections].join(' ')}`,
    `frame-src blob: ${frames.join(' ')}`, "worker-src 'self' blob:",
    "object-src 'none'", "base-uri 'none'", "form-action 'self'",
  ].join('; ');
}

export function securityPolicyPlugin(desktop: boolean, env: Record<string, string>): Plugin {
  return {
    name: 'beskar-security-policy',
    // Dev HMR needs inline scripts. Production outputs always get the policy.
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: html => ({
        html: html.replace(/<meta\s+charset=["']?[^>]+>/i, ''),
        tags: [
          // Keep encoding within the first 1024 bytes, ahead of the long policy.
          { tag: 'meta', attrs: { charset: 'UTF-8' }, injectTo: 'head-prepend' },
          { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: contentSecurityPolicy(desktop, env) }, injectTo: 'head-prepend' },
          { tag: 'meta', attrs: { name: 'referrer', content: 'no-referrer' }, injectTo: 'head-prepend' },
        ],
      }),
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: '_headers', source:
        `/*\n  Content-Security-Policy: ${contentSecurityPolicy(desktop, env)}; frame-ancestors 'none'\n  Referrer-Policy: no-referrer\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n` });
    },
  };
}
