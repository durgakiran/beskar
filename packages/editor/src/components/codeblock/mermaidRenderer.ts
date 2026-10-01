export const MAX_MERMAID_SOURCE_LENGTH = 10_000;

let mermaidPromise: Promise<typeof import('mermaid')> | undefined;
let renderQueue: Promise<unknown> = Promise.resolve();
let nextRenderId = 0;

/** Mermaid has global configuration and uses the DOM, so serialize theme-specific renders. */
export function renderMermaid(source: string, theme: 'default' | 'dark', signal: AbortSignal): Promise<string> {
  if (source.length > MAX_MERMAID_SOURCE_LENGTH) {
    return Promise.reject(new Error('Diagram source is too large to preview (10,000 character limit).'));
  }
  const result = renderQueue.then(async () => {
    if (signal.aborted) throw new DOMException('Preview cancelled', 'AbortError');
    const { default: mermaid } = await (mermaidPromise ??= import('mermaid').catch(error => {
      mermaidPromise = undefined;
      throw error;
    }));
    if (signal.aborted) throw new DOMException('Preview cancelled', 'AbortError');
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme, maxTextSize: MAX_MERMAID_SOURCE_LENGTH });
    const { svg } = await mermaid.render(`beskar-mermaid-${++nextRenderId}`, source);
    if (signal.aborted) throw new DOMException('Preview cancelled', 'AbortError');
    return svg;
  });
  renderQueue = result.catch(() => undefined);
  return result;
}
