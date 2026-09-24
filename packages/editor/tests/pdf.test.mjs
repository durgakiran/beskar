import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { buildPdfDefinition, createDocumentPdf, pdfFileName, safePdfLink } from '../dist/pdf.mjs';

const text = value => ({ type: 'text', text: value });
const paragraph = value => ({ type: 'paragraph', content: [text(value)] });
const cell = (value, attrs = {}, type = 'tableCell') => ({ type, attrs, content: [paragraph(value)] });
const row = (...content) => ({ type: 'tableRow', content });
const doc = (...content) => ({ type: 'doc', content });

test('safe filenames and links reject active content while preserving document links', () => {
  assert.equal(pdfFileName('../bad:name?'), '..-bad-name-.pdf');
  assert.equal(pdfFileName('   '), 'Untitled.pdf');
  assert.equal(safePdfLink('javascript:alert(1)'), undefined);
  assert.equal(safePdfLink('data:text/html,hi'), undefined);
  assert.equal(safePdfLink('/space/one', 'https://app.example/'), 'https://app.example/space/one');
});

test('preserves rich text and links while excluding comment annotations', async () => {
  const source = doc({ type: 'paragraph', content: [{ ...text('Marked'), marks: [{ type: 'bold' }, { type: 'italic' }, { type: 'underline' }, { type: 'strike' }, { type: 'comment', attrs: { text: 'PRIVATE COMMENT' } }, { type: 'link', attrs: { href: 'https://example.com' } }] }] });
  const { definition, warnings } = await buildPdfDefinition(source, { title: 'Test', pageSize: 'LETTER', orientation: 'landscape' });
  const run = definition.content[1].text[0];
  assert.equal(run.bold, true);
  assert.deepEqual(run.decoration, ['underline', 'lineThrough']);
  assert.equal(run.link, 'https://example.com/');
  assert.equal(JSON.stringify(definition).includes('PRIVATE COMMENT'), false);
  assert.equal(definition.pageOrientation, 'landscape');
  assert.deepEqual(warnings, []);
});

test('merged tables retain rectangular rows and repeat only safe headers', async () => {
  const table = { type: 'table', content: [row(cell('Header A', {}, 'tableHeader'), cell('Header B', {}, 'tableHeader')), row(cell('Merged', { rowspan: 2 }), cell('B')), row(cell('C')), row(cell('Wide', { colspan: 2 }))] };
  const { definition } = await buildPdfDefinition(doc(table), { title: 'Table' });
  const result = definition.content[1].table;
  assert.equal(result.headerRows, 1);
  assert.deepEqual(result.body.map(row => row.length), [2, 2, 2, 2]);
  assert.equal(result.body[1][0].rowSpan, 2);
  assert.deepEqual(result.body[2][0], {});
  assert.equal(result.body[3][0].colSpan, 2);
  const rendered = await createDocumentPdf(doc(table), { title: 'Merged table' });
  assert.ok(rendered.blob.size > 1000);
});

test('deduplicates image requests and reports missing assets instead of aborting', async () => {
  let requests = 0;
  const source = doc({ type: 'imageBlock', attrs: { src: 'missing', alt: 'Logo' } }, { type: 'imageBlock', attrs: { src: 'missing' } });
  const { definition, warnings } = await buildPdfDefinition(source, { title: 'Images', resolveImage: async () => { requests++; throw new Error('403'); } });
  assert.equal(requests, 1);
  assert.equal(warnings.length, 1);
  assert.match(JSON.stringify(definition), /Image unavailable: Logo/);
});

test('snapshot is captured before asynchronous PDF loading', async () => {
  const source = doc({ type: 'mathBlock', attrs: { latex: 'ORIGINAL' } });
  let captured;
  const pending = createDocumentPdf(source, { title: 'Snapshot', renderMath: async latex => { captured = latex; throw new Error('Fallback'); } });
  source.content[0].attrs.latex = 'CHANGED';
  const result = await pending;
  assert.equal(captured, 'ORIGINAL');
  assert.equal(result.warnings.length, 1);
});

test('custom nodes have explicit fallbacks and unsafe links are removed', async () => {
  const { definition, warnings } = await buildPdfDefinition(doc(
    { type: 'paragraph', content: [{ type: 'statusBadge', attrs: { label: 'DONE' } }, { type: 'inlineMath', attrs: { latex: 'x^2' } }, { type: 'externalLinkInline', attrs: { title: 'Bad link', href: 'javascript:alert(1)' } }] },
    { type: 'columns', content: [{ type: 'column', content: [paragraph('Left')] }, { type: 'column', content: [paragraph('Right')] }] },
    { type: 'futureBlock' },
  ), { title: 'Custom nodes' });
  assert.equal(warnings.length, 3);
  assert.match(JSON.stringify(definition), /DONE/);
  assert.equal(JSON.stringify(definition).includes('javascript:'), false);
});

test('generates a multi-page PDF with equations, long code, lists, links and tables', async () => {
  const source = doc(
    { type: 'heading', attrs: { level: 1 }, content: [text('Export verification')] },
    paragraph('A searchable PDF with text, formatting and vector equations.'),
    { type: 'mathBlock', attrs: { latex: '\\int_0^1 x^2\\,dx = \\frac{1}{3}' } },
    { type: 'noteBlock', content: [text('This callout should wrap inside the page margins.')] },
    { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [paragraph('First item')] }, { type: 'listItem', content: [paragraph('Second item')] }] },
    { type: 'codeBlock', content: [text('function exportPdf() {\n    return "' + 'long'.repeat(65) + '";\n}')] },
    { type: 'table', content: [row(cell('Name', {}, 'tableHeader'), cell('Description', {}, 'tableHeader')), ...Array.from({ length: 75 }, (_, i) => row(cell(`Row ${i + 1}`), cell('Table headers should repeat on each page.')))] },
    ...Array.from({ length: 8 }, (_, i) => paragraph(`Closing paragraph ${i + 1}. ` + 'Content flows across pages. '.repeat(10))),
  );
  const result = await createDocumentPdf(source, { title: 'PDF export verification' });
  const buffer = Buffer.from(await result.blob.arrayBuffer());
  assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
  assert.ok(buffer.length > 20000);
  assert.deepEqual(result.warnings, []);
  if (process.env.PDF_TEST_OUTPUT) writeFileSync(process.env.PDF_TEST_OUTPUT, buffer);
});

test('inline captions survive PDF export for both resolved and unavailable images', async () => {
  const source = doc({ type: 'paragraph', content: [{ type: 'imageInline', attrs: { src: 'test-image', alt: 'Image description', caption: 'Separate caption' } }] });
  for (const resolveImage of [undefined, async () => 'data:image/png;base64,test']) {
    const { definition } = await buildPdfDefinition(source, { title: 'Inline captions', resolveImage });
    assert.ok(definition.content.some(item => item.text === 'Separate caption'));
  }
});
