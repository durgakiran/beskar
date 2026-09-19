import type { EditorState } from '@tiptap/pm/state';
import { TextSelection } from '@tiptap/pm/state';
import { common, createLowlight } from 'lowlight';

export const codeLowlight = createLowlight(common);
const labels: Record<string, string> = {
  javascript: 'JavaScript', typescript: 'TypeScript', cpp: 'C++', csharp: 'C#',
  plaintext: 'Plain Text', xml: 'HTML / XML', bash: 'Bash', objectivec: 'Objective-C',
  css: 'CSS', scss: 'SCSS', json: 'JSON', sql: 'SQL', yaml: 'YAML', php: 'PHP',
};
export const languageLabel = (language: string) => labels[language] || language[0]?.toUpperCase() + language.slice(1);
export const codeLanguages = codeLowlight.listLanguages().sort();
const aliases: Record<string, string> = { js: 'javascript', ts: 'typescript', html: 'xml', htm: 'xml', sh: 'bash', py: 'python', yml: 'yaml', text: 'plaintext', txt: 'plaintext', 'c++': 'cpp', 'c#': 'csharp' };
export const normalizeLanguage = (language: string | null) => aliases[language || ''] || language || 'plaintext';
export function filterLanguages(query: string, recent: string[]) {
  const term = query.trim().toLowerCase();
  return [...new Set([...recent.filter(l => codeLanguages.includes(l)), ...codeLanguages])].filter(l =>
    `${l} ${languageLabel(l)} ${Object.keys(aliases).filter(a => aliases[a] === l).join(' ')}`.toLowerCase().includes(term));
}

/** Indent whole logical lines, even when a selection starts midway through one. */
export function indentCode(state: EditorState, outdent = false) {
  const { selection } = state;
  const { $from, $to, from, to } = selection;
  if (!(selection instanceof TextSelection) || $from.parent.type.name !== 'codeBlock' || !$from.sameParent($to)) return null;
  const start = $from.start();
  const text = $from.parent.textContent;
  const first = from === start ? 0 : text.lastIndexOf('\n', from - start - 1) + 1;
  const end = to - start;
  const lines = [first];
  for (let i = text.indexOf('\n', first); i >= 0 && i + 1 < end; i = text.indexOf('\n', i + 1)) lines.push(i + 1);
  const tr = state.tr;
  for (const offset of lines.reverse()) {
    if (outdent) {
      const count = text[offset] === '\t' ? 1 : Math.min(2, text.slice(offset).match(/^ */)![0].length);
      if (count) tr.delete(start + offset, start + offset + count);
    } else tr.insertText('  ', start + offset);
  }
  tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(selection.anchor), tr.mapping.map(selection.head)));
  return tr.scrollIntoView();
}

/** Copy without changing the ProseMirror selection; restore DOM focus in the legacy fallback. */
export async function copyCodeText(text: string) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return; }
  } catch { /* Some embedded/HTTP hosts need the synchronous clipboard fallback. */ }
  const active = document.activeElement as HTMLElement | null;
  const selection = window.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
  const input = document.createElement('textarea');
  input.value = text;
  input.style.cssText = 'position:fixed;left:-10000px;top:0';
  document.body.append(input);
  try {
    input.select();
    if (!document.execCommand('copy')) throw new Error('Clipboard unavailable');
  } finally {
    input.remove();
    active?.focus({ preventScroll: true });
    selection?.removeAllRanges();
    ranges.forEach(range => selection?.addRange(range));
  }
}

/** Static HTML preview: opaque origin, no scripts, forms, navigation privileges or network. */
export function htmlPreview(source: string) {
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'"><style>body{font:14px/1.5 system-ui;margin:16px;overflow-wrap:anywhere}img{max-width:100%}</style></head><body>${source}</body></html>`;
}
