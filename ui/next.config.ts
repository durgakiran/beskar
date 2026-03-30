import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  webpack(config) {
    // The editor package is mounted via a Docker volume at /opt/packages/editor
    // and installed as a symlink in node_modules. Without this flag webpack
    // follows the symlink and resolves peer imports (e.g. @tiptap/pm,
    // prosemirror-view) from /opt/packages/editor/node_modules, creating a
    // second copy of the same singleton and causing runtime crashes.
    // Setting symlinks:false keeps resolution anchored at /app/node_modules.
    config.resolve.symlinks = false;
    return config;
  },
};

export default nextConfig;
