import katex from 'katex';

/** Strict parsing gives the UI a real error state instead of stale or raw markup. */
export function renderMath(latex: string, displayMode: boolean, block = displayMode) {
  if (!latex.trim()) return { html: '', error: null };
  try {
    return { html: katex.renderToString(latex, {
      displayMode, throwOnError: true, trust: false, strict: 'warn',
      // Preserve the existing block macro for saved documents.
      macros: block ? { '\\f': '#1f(#2)' } : {},
    }), error: null };
  } catch (error) {
    return { html: '', error: error instanceof Error ? error.message : 'Invalid equation' };
  }
}

/** A small LaTeX lexer: React escapes token text; no user HTML is interpolated. */
export function highlightMath(source: string) {
  return source.split(/(\\(?:[a-zA-Z]+|[^\n])|%[^\n]*|[{}\[\]^_&$]|\b\d+(?:\.\d+)?\b)/g).filter(Boolean).map(text => ({
    text,
    kind: text.startsWith('\\') ? 'command' : text.startsWith('%') ? 'comment'
      : /^[{}\[\]^_&$]$/.test(text) ? 'symbol' : /^\d/.test(text) ? 'number' : 'plain',
  }));
}
