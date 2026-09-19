import type { JSONContent } from '@tiptap/core';
import type { Content, ContentText, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';

export interface PdfExportOptions {
  title: string;
  pageSize?: 'A4' | 'LETTER';
  orientation?: 'portrait' | 'landscape';
  /** The host resolves authenticated media; no credentials are stored in the PDF. */
  resolveImage?: (src: string) => Promise<string>;
  renderMath?: (latex: string, display: boolean) => Promise<{ svg: string; width: number; height: number }>;
  resolveDocumentLink?: (attrs: Record<string, unknown>) => string | undefined;
  baseUrl?: string;
}

export function pdfFileName(title: string): string {
  return `${title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '').trim().slice(0, 120) || 'Untitled'}.pdf`;
}

export function safePdfLink(value: unknown, baseUrl?: string): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const url = new URL(value, baseUrl);
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol) ? url.href : undefined;
  } catch { return undefined; }
}
const color = (value: unknown, fallback?: string) => typeof value === 'string' && /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(value) ? value : fallback;
const textOf = (node: JSONContent): string => node.text ?? (node.type === 'hardBreak' ? '\n' : (node.content ?? []).map(textOf).join(''));
const alignment = (value: unknown): 'left' | 'right' | 'center' | 'justify' => ['left', 'right', 'center', 'justify'].includes(String(value)) ? value as 'left' | 'right' | 'center' | 'justify' : 'left';

/** Converts a detached TipTap snapshot, never the live editor DOM. */
export async function buildPdfDefinition(doc: JSONContent, options: PdfExportOptions): Promise<{ definition: TDocumentDefinitions; warnings: string[] }> {
  const warnings = new Set<string>();
  const pageWidth = options.pageSize === 'LETTER' ? 612 : 595.28;
  const pageHeight = options.pageSize === 'LETTER' ? 792 : 841.89;
  const width = (options.orientation === 'landscape' ? pageHeight : pageWidth) - 88;
  const height = (options.orientation === 'landscape' ? pageWidth : pageHeight) - 100;
  const images = new Map<string, Promise<string>>();
  const warn = (message: string) => { warnings.add(message); };
  // Bundled Roboto covers Latin, Greek and Cyrillic, not every Unicode script.
  if (/[\u0590-\u1cff\u2e80-\ua4cf\uac00-\ud7af\u{1f000}-\u{1faff}]/u.test(JSON.stringify(doc) + options.title)) {
    warn('Some scripts or emoji may not be available in the bundled PDF font. Check those characters in the exported file.');
  }
  const link = (value: unknown) => safePdfLink(value, options.baseUrl);

  async function inline(node: JSONContent): Promise<ContentText> {
    const attrs = node.attrs ?? {};
    let text = node.text ?? '';
    let href: string | undefined;
    switch (node.type) {
      case 'hardBreak': text = '\n'; break;
      case 'statusBadge': text = `[${attrs.label ?? ''}]`; break;
      case 'dateInline': text = String(attrs.value ?? ''); break;
      case 'emoji': text = String(attrs.emoji ?? attrs.name ?? ''); break;
      case 'attachmentInline': text = String(attrs.fileName || 'Attachment'); href = link(attrs.fileUrl); break;
      case 'internalDocInline': text = String(attrs.resourceTitle || 'Linked document'); href = link(attrs.href || options.resolveDocumentLink?.(attrs)); break;
      case 'externalLinkInline': text = String(attrs.title || attrs.href || 'Link'); href = link(attrs.href); break;
      case 'embedInline': text = String(attrs.title || attrs.src || 'Embed'); href = link(attrs.src); break;
      case 'inlineMath':
        // pdfmake text runs do not support inline SVG; retain the exact formula.
        text = String(attrs.latex ?? '');
        warn('Inline equations are exported as LaTeX text.'); break;
      case 'text': break;
      default:
        text = textOf(node) || `[${node.type || 'Unsupported inline content'}]`;
        warn(`Some ${node.type || 'unknown'} content uses a text fallback.`);
    }
    const run: ContentText = { text, ...(href ? { link: href, color: '#2457a7' } : {}) };
    const decoration: ('underline' | 'lineThrough')[] = [];
    for (const mark of node.marks ?? []) {
      if (mark.type === 'bold') run.bold = true;
      if (mark.type === 'italic') run.italics = true;
      if (mark.type === 'underline') decoration.push('underline');
      if (mark.type === 'strike') decoration.push('lineThrough');
      if (mark.type === 'code') run.background = '#f1f2f4';
      if (mark.type === 'highlight') run.background = color(mark.attrs?.color, '#fff1a8');
      if (mark.type === 'textStyle') run.color = color(mark.attrs?.color, run.color);
      if (mark.type === 'link') {
        const href = link(mark.attrs?.href);
        if (href) { run.link = href; run.color = '#2457a7'; }
      }
    }
    if (decoration.length) run.decoration = decoration;
    return run;
  }

  async function paragraph(node: JSONContent, available: number): Promise<Content[]> {
    // Inline images are placed between text fragments, preserving reading order.
    const output: Content[] = [];
    let runs: ContentText[] = [];
    const flush = () => { if (runs.length) { output.push({ text: runs, margin: [0, 0, 0, 7], alignment: alignment(node.attrs?.textAlign) }); runs = []; } };
    for (const child of node.content ?? []) {
      if (['imageInline', 'image', 'imageBlock'].includes(child.type ?? '')) {
        flush(); output.push(...await block(child, available));
        warn('Inline images are placed on their own line.');
      } else runs.push(await inline(child));
    }
    flush();
    return output.length ? output : [{ text: ' ', margin: [0, 0, 0, 7] }];
  }
  async function children(node: JSONContent, available: number): Promise<Content[]> {
    const result: Content[] = [];
    for (const child of node.content ?? []) result.push(...await block(child, available));
    return result;
  }
  async function table(node: JSONContent, available: number): Promise<Content[]> {
    const rows = node.content ?? [];
    if (!rows.length) return [];
    const body: TableCell[][] = rows.map(() => []);
    const occupied = new Set<string>();
    let cols = 0;
    const cells: { node: JSONContent; r: number; c: number; colspan: number; rowspan: number }[] = [];
    for (let r = 0; r < rows.length; r++) {
      let c = 0;
      for (const cell of rows[r].content ?? []) {
        while (occupied.has(`${r}:${c}`)) c++;
        const colspan = Math.max(1, Math.min(50, Number(cell.attrs?.colspan) || 1));
        const rowspan = Math.max(1, Math.min(rows.length - r, Number(cell.attrs?.rowspan) || 1));
        for (let y = r; y < r + rowspan; y++) for (let x = c; x < c + colspan; x++) {
          occupied.add(`${y}:${x}`); body[y][x] = {};
        }
        cells.push({ node: cell, r, c, colspan, rowspan });
        c += colspan;
      }
      cols = Math.max(cols, body[r].length);
    }
    if (!cols) return [];
    for (const { node: cell, r, c, colspan, rowspan } of cells) {
      body[r][c] = { stack: await children(cell, Math.max(12, (available - cols * 9) / cols * colspan)), colSpan: colspan, rowSpan: rowspan,
        bold: cell.type === 'tableHeader', fillColor: color(cell.attrs?.backgroundColor, cell.type === 'tableHeader' ? '#f1f2f4' : undefined) };
    }
    for (const row of body) for (let c = 0; c < cols; c++) row[c] ??= { text: '' };
    // A vertically merged header must not be repeated independently of its body.
    const headerRows = rows[0].content?.every(c => c.type === 'tableHeader' && (c.attrs?.rowspan ?? 1) === 1) && rows.length > 1 ? 1 : 0;
    return [{ table: { headerRows, widths: Array(cols).fill('*'), body }, margin: [0, 5, 0, 12], layout: 'lightHorizontalLines' }];
  }
  async function block(node: JSONContent, available: number): Promise<Content[]> {
    const attrs = node.attrs ?? {};
    switch (node.type) {
      case 'doc': case 'column': case 'details': case 'detailsContent': case 'listItem': case 'taskItem': return children(node, available);
      case 'paragraph': return paragraph(node, available);
      case 'heading': case 'detailsSummary': return [{ text: await Promise.all((node.content ?? []).map(inline)), fontSize: [24, 20, 17, 14, 12, 11][Math.max(0, Math.min(5, Number(attrs.level || 3) - 1))], bold: true, margin: [0, 12, 0, 7], headlineLevel: Number(attrs.level || 3), alignment: alignment(attrs.textAlign) }];
      case 'bulletList': case 'orderedList': case 'taskList': {
        const items: Content[] = [];
        for (const item of node.content ?? []) {
          const stack = await children(item, available - 20);
          if (node.type === 'taskList') stack.unshift({ text: item.attrs?.checked ? '[x]' : '[ ]', bold: true });
          items.push({ stack: stack.length ? stack : [{ text: ' ' }] });
        }
        return items.length ? [node.type === 'orderedList' ? { ol: items, start: Number(attrs.start) || 1, margin: [0, 3, 0, 8] } : { ul: items, margin: [0, 3, 0, 8] }] : [];
      }
      case 'blockquote': return [{ stack: await children(node, available - 18), margin: [18, 6, 0, 8], color: '#525866', italics: true }];
      case 'noteBlock': return [{ table: { widths: ['*'], body: [[{ stack: await paragraph(node, available - 16), fillColor: color(attrs.backgroundColor, '#f3f0ff'), margin: [8, 8, 8, 4] }]] }, layout: 'noBorders', margin: [0, 6, 0, 10] }];
      case 'codeBlock': return [{ text: textOf(node) || ' ', fontSize: 9, preserveLeadingSpaces: true, background: '#f1f2f4', margin: [0, 6, 0, 10] }];
      case 'horizontalRule': return [{ canvas: [{ type: 'line', x1: 0, y1: 0, x2: available, y2: 0, lineWidth: 0.7, lineColor: '#d1d5db' }], margin: [0, 10, 0, 10] }];
      case 'table': return table(node, available);
      case 'columns': {
        // Linearize so wide or nested content never spills outside its column.
        warn('Multi-column layouts are exported in reading order.');
        return children(node, available);
      }
      case 'image': case 'imageBlock': case 'imageInline': {
        try {
          if (!attrs.src || !options.resolveImage) throw new Error('Image unavailable');
          if (!images.has(attrs.src)) images.set(attrs.src, options.resolveImage(attrs.src));
          const src = await images.get(attrs.src)!;
          const imageWidth = Math.min(available, Number(attrs.width) > 0 ? Number(attrs.width) * 0.75 : available);
          const result: Content[] = [{ image: src, fit: [imageWidth, height - 40], alignment: alignment(attrs.align), margin: [0, 5, 0, 6] }];
          if (attrs.caption) result.push({ text: String(attrs.caption), italics: true, fontSize: 9, margin: [0, 0, 0, 10] });
          return result;
        } catch {
          warn('Some images could not be loaded; placeholders were included.');
          return [
            { text: `[Image unavailable${attrs.alt ? `: ${attrs.alt}` : ''}]`, color: '#666666', margin: [0, 6, 0, 6] },
            ...(attrs.caption ? [{ text: String(attrs.caption), italics: true, fontSize: 9, margin: [0, 0, 0, 10] } as Content] : []),
          ];
        }
      }
      case 'mathBlock': {
        try {
          if (!options.renderMath) throw new Error('No math renderer');
          const math = await options.renderMath(String(attrs.latex ?? ''), true);
          const scale = Math.min(1, available / math.width, (height - 30) / math.height);
          return [{ svg: math.svg, width: math.width * scale, height: math.height * scale, alignment: 'center', margin: [0, 8, 0, 12] }];
        } catch {
          warn('Some equations could not be rendered and are exported as LaTeX text.');
          return [{ text: String(attrs.latex || ' '), italics: true, margin: [0, 8, 0, 12] }];
        }
      }
      case 'embedBlock': return [{ text: String(attrs.title || attrs.src || 'Embedded content'), link: link(attrs.src), color: '#2457a7', margin: [0, 6, 0, 10] }];
      case 'internalLinkBlock': return [{ text: String(attrs.resourceTitle || 'Linked document'), link: link(options.resolveDocumentLink?.(attrs)), color: '#2457a7', margin: [0, 6, 0, 10] }];
      case 'tableOfContents': warn('The interactive table of contents is omitted.'); return [];
      case 'childPagesList': warn('The live child-page list is omitted.'); return [{ text: '[Child pages: open the original document]', color: '#666666' }];
      default:
        warn(`Some ${node.type || 'unknown'} content uses a text fallback.`);
        return node.content?.length ? children(node, available) : [{ text: node.text || `[${node.type || 'Unsupported content'}]` }];
    }
  }
  const content = await block(doc, width);
  return {
    definition: {
      info: { title: options.title || 'Untitled', creator: 'Beskar' },
      pageSize: options.pageSize ?? 'A4', pageOrientation: options.orientation ?? 'portrait', pageMargins: [44, 44, 44, 50],
      defaultStyle: { font: 'Roboto', fontSize: 11, lineHeight: 1.25, color: '#20242b' },
      content: [{ text: options.title || 'Untitled', fontSize: 28, bold: true, margin: [0, 0, 0, 20] }, ...content],
      footer: (page, pages) => ({ text: `${page} / ${pages}`, alignment: 'center', fontSize: 9, color: '#737780', margin: [0, 15, 0, 0] }),
      pageBreakBefore: (node, container) => Boolean(node.headlineLevel && container.getFollowingNodesOnPage().length === 0),
    },
    warnings: [...warnings],
  };
}
