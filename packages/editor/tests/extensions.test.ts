import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Editor, Extension, flattenExtensions, getSchema } from '@tiptap/core';
import { getExtensions } from '../src/extensions';
import { EDITOR_FEATURE_EXTENSIONS, MANDATORY_EDITOR_EXTENSIONS, type EditorFeature } from '../src/extensions/features';
import { GROUPS } from '../src/extensions/slash-command/groups';
import { convertListBlockTransaction } from '../src/extensions/list-conversion';
import { normalizeHyperlink } from '../src/utils/hyperlink';

test('hyperlinks normalize destinations and reject unsafe or malformed URLs', () => {
  for (const [input, expected] of [
    [' example.com/path ', 'https://example.com/path'],
    ['https://example.com/a?q=1#b', 'https://example.com/a?q=1#b'],
    ['mailto:hello@example.com', 'mailto:hello@example.com'],
    ['tel:+123456789', 'tel:+123456789'],
    ['/documents/one', '/documents/one'],
    ['#section', '#section'],
  ]) assert.equal(normalizeHyperlink(input), expected);
  for (const input of ['', 'javascript:alert(1)', 'data:text/html,test', 'vbscript:msgbox(1)',
    'java\nscript:alert(1)', 'https://', 'not a url', 'https:\\example.com', 'mailto:']) {
    assert.equal(normalizeHyperlink(input), null, input);
  }
});

const names = (extensions: ReturnType<typeof getExtensions>) => flattenExtensions(extensions).map((e) => e.name);

test('default preset preserves all optional features without duplicate extensions', () => {
  const extensions = getExtensions();
  const registered = names(extensions);
  assert.equal(new Set(registered).size, registered.length);
  for (const group of Object.values(EDITOR_FEATURE_EXTENSIONS)) {
    for (const name of group) assert.ok(registered.includes(name), name);
  }
  getSchema(extensions);
});

test('search extraction supports every node in the live default editor schema', () => {
  const extensions = getExtensions();
  const schema = getSchema(extensions);
  const emoji = flattenExtensions(extensions).find(extension => extension.name === 'emoji')!;
  const emojis: Record<string, string> = {};
  for (const item of emoji.options.emojis) {
    for (const name of [item.name, ...item.shortcodes]) {
      if (!Object.hasOwn(emojis, name)) emojis[name] = item.emoji || `:${name}:`;
    }
  }
  const directory = mkdtempSync(join(tmpdir(), 'searchtext-editor-contract-'));
  const path = join(directory, 'contract.json');
  try {
    writeFileSync(path, JSON.stringify({ nodeTypes: Object.keys(schema.nodes), emojis }));
    execFileSync('go', ['test', './searchtext', '-run', '^TestEditorNodeCoverage$', '-count=1'], {
      cwd: fileURLToPath(new URL('../../../server/', import.meta.url)),
      env: { ...process.env, SEARCHTEXT_EDITOR_CONTRACT_FILE: path },
      encoding: 'utf8',
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('minimal preset retains mandatory extensions and a valid paragraph document', () => {
  const extensions = getExtensions({ features: { preset: 'minimal' } });
  const registered = names(extensions);
  for (const name of MANDATORY_EDITOR_EXTENSIONS) assert.ok(registered.includes(name), name);
  for (const group of Object.values(EDITOR_FEATURE_EXTENSIONS)) {
    for (const name of group) assert.ok(!registered.includes(name), name);
  }
  const schema = getSchema(extensions);
  const document = schema.node('doc', null, [schema.node('paragraph', null, schema.text('Hello'))]);
  document.check();
  assert.equal(document.textContent, 'Hello');
});

for (const feature of Object.keys(EDITOR_FEATURE_EXTENSIONS) as EditorFeature[]) {
  test(`${feature}: independently enabled or disabled with a valid schema`, () => {
    const only = getExtensions({ features: { preset: 'minimal', [feature]: true } });
    const without = getExtensions({ features: { [feature]: false } });
    for (const name of EDITOR_FEATURE_EXTENSIONS[feature]) {
      assert.ok(names(only).includes(name), name);
      assert.ok(!names(without).includes(name), name);
    }
    getSchema(only).topNodeType.createAndFill()!.check();
    getSchema(without).topNodeType.createAndFill()!.check();
  });
}

test('custom additions work; duplicate and mandatory replacements fail, including nested kits', () => {
  const custom = Extension.create({ name: 'clientExtension' });
  assert.ok(names(getExtensions({ additionalExtensions: [custom] })).includes('clientExtension'));
  assert.throws(() => getExtensions({ additionalExtensions: [Extension.create({ name: 'paragraph' })] }), /mandatory extensions cannot be replaced/);
  const kit = Extension.create({ name: 'clientKit', addExtensions: () => [Extension.create({ name: 'doc' })] });
  assert.throws(() => getExtensions({ additionalExtensions: [kit] }), /Duplicate editor extension "doc"/);
});

test('slash menu exposes only enabled nodes when formatting is disabled', () => {
  const editor = new Editor({ element: null, extensions: getExtensions({ features: { preset: 'minimal', slashCommands: true, details: true } }), content: { type: 'doc', content: [{ type: 'paragraph' }] } });
  const slash = editor.extensionManager.extensions.find((extension) => extension.name === 'slashCommand')!;
  const groups = slash.options.suggestion.items({ editor, query: '' });
  assert.deepEqual(groups.flatMap((group: typeof GROUPS[number]) => group.commands.map((command) => command.name)), ['details']);
  editor.destroy();
});

test('disabled optional built-ins can be replaced by a client', () => {
  const heading = getExtensions().find((extension) => extension.name === 'heading')!;
  const extensions = getExtensions({ features: { preset: 'minimal' }, additionalExtensions: [heading] });
  assert.ok(getSchema(extensions).nodes.heading);
  assert.equal(names(extensions).filter((name) => name === 'heading').length, 1);
});

test('disabling attachments also removes their image drop handler', () => {
  const handler = { uploadAttachment: async () => { throw new Error('unused'); } };
  const extensions = getExtensions({ features: { attachments: false }, attachmentHandler: handler as any });
  assert.equal(extensions.find((extension) => extension.name === 'imagePasteDrop')!.options.attachmentHandler, undefined);
});

test('collaboration retains required plugins and disables competing local history', () => {
  const extensions = getExtensions({ features: { preset: 'minimal' }, collaboration: { provider: {} as any, user: { id: 'test', name: 'Test', color: '#aaaaaa' } } });
  const registered = names(extensions);
  assert.ok(registered.includes('collaboration'));
  assert.ok(registered.includes('collaborationCaret'));
  assert.ok(!registered.includes('undoRedo'));
  for (const name of MANDATORY_EDITOR_EXTENSIONS) assert.ok(registered.includes(name), name);
});

test('document lists carry style scope independently of block IDs', () => {
  const schema = getSchema(getExtensions());
  for (const name of ['bulletList', 'orderedList', 'taskList']) {
    const node = schema.nodes[name].createAndFill()!;
    const dom = schema.nodes[name].spec.toDOM!(node) as any[];
    assert.equal(dom[1]['data-editor-list'], 'true', name);
  }
});

test('block list conversion preserves content, nested lists, block ID, and cursor', () => {
  const schema = getSchema(getExtensions());
  const paragraph = (text: string) => schema.nodes.paragraph.create(null, schema.text(text));
  const nested = schema.nodes.bulletList.create(null, [
    schema.nodes.listItem.create(null, [paragraph('nested')]),
  ]);
  const source = schema.nodes.bulletList.create({ blockId: 'list-1' }, [
    schema.nodes.listItem.create(null, [paragraph('first'), nested]),
    schema.nodes.listItem.create(null, [paragraph('second')]),
  ]);
  const doc = schema.nodes.doc.create(null, [paragraph('before'), source, paragraph('after')]);
  const listPos = doc.child(0).nodeSize;
  let state = EditorState.create({ doc, selection: TextSelection.create(doc, listPos + 3) });

  for (const target of ['orderedList', 'taskList', 'bulletList'] as const) {
    const tr = convertListBlockTransaction(state, 'list-1', target);
    assert.ok(tr, target);
    state = state.apply(tr);
    state.doc.check();
    const converted = state.doc.child(1);
    assert.equal(converted.type.name, target);
    assert.equal(converted.attrs.blockId, 'list-1');
    assert.equal(converted.childCount, 2);
    assert.equal(converted.child(0).type.name, target === 'taskList' ? 'taskItem' : 'listItem');
    assert.equal(converted.child(0).child(1).type.name, 'bulletList');
    assert.equal(converted.textContent, 'firstnestedsecond');
    assert.equal(state.selection.from, listPos + 3);
  }
  assert.equal(convertListBlockTransaction(state, 'list-1', 'bulletList'), null);
  assert.equal(convertListBlockTransaction(state, 'missing', 'orderedList'), null);
});

// Exercise the actual shared resolver used by all external-link node views.
import { resolveLinkMetadata, LINK_FAILURE_COOLDOWN } from '../src/utils/linkMetadata';

test('external link previews share in-flight and successful requests', async () => {
  let calls = 0;
  const handler = { getLinkMetadata: async () => { calls++; return { url: 'https://example.com', title: 'Example' }; } };
  const first = resolveLinkMetadata(handler, 'https://example.com');
  assert.equal(resolveLinkMetadata(handler, 'https://example.com', true), first);
  await first;
  await resolveLinkMetadata(handler, 'https://example.com');
  assert.equal(calls, 1);
  await resolveLinkMetadata(handler, 'https://example.com', true);
  assert.equal(calls, 2);
});

test('failed previews remain cached across consumers until cooldown or manual retry', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  let calls = 0;
  const handler = { getLinkMetadata: async () => { calls++; throw new Error('offline'); } };
  await assert.rejects(resolveLinkMetadata(handler, 'https://example.com'));
  await assert.rejects(resolveLinkMetadata(handler, 'https://example.com'));
  assert.equal(calls, 1);
  await assert.rejects(resolveLinkMetadata(handler, 'https://example.com', true));
  assert.equal(calls, 2);
  t.mock.timers.tick(LINK_FAILURE_COOLDOWN + 1);
  await assert.rejects(resolveLinkMetadata(handler, 'https://example.com'));
  assert.equal(calls, 3);
});

test('null metadata is a cached failure; empty titles are successful metadata', async () => {
  let calls = 0;
  const handler = { getLinkMetadata: async () => { calls++; return null; } };
  await assert.rejects(resolveLinkMetadata(handler, 'https://example.com'));
  await assert.rejects(resolveLinkMetadata(handler, 'https://example.com'));
  assert.equal(calls, 1);
  const empty = { getLinkMetadata: async () => ({ url: 'https://example.com', title: '' }) };
  assert.equal((await resolveLinkMetadata(empty, 'https://example.com')).title, '');
});

test('preview timeout aborts the handler and is cached even if handler ignores abort', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal: AbortSignal | undefined;
  const handler = { getLinkMetadata: async (_url: string, input?: AbortSignal) => {
    signal = input;
    return new Promise<never>(() => {});
  } };
  const result = resolveLinkMetadata(handler, 'https://example.com');
  const rejected = assert.rejects(result, /timed out/);
  await Promise.resolve();
  t.mock.timers.tick(10_000);
  await rejected;
  assert.equal(signal?.aborted, true);
  await assert.rejects(resolveLinkMetadata(handler, 'https://example.com'), /timed out/);
});

import { renderMath, highlightMath } from '../src/components/math/mathRendering';
import { inlineMathInputRules, blockMathInputRule } from '../src/extensions/math-input-rules';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { createChainableState } from '@tiptap/core';

test('math rendering clears empty output and reports invalid syntax', () => {
  assert.match(renderMath('x^2', true).html, /katex/);
  assert.deepEqual(renderMath('   ', true), { html: '', error: null });
  const invalid = renderMath('\\frac{', false);
  assert.equal(invalid.html, '');
  assert.ok(invalid.error);
  assert.equal(renderMath('\\begin{aligned}a&=b\\\\c&=d\\end{aligned}', true).error, null);
});

test('math source highlighting preserves all input characters', () => {
  const source = '\\frac{12}{x_2} % comment\n<script>alert(1)</script>';
  const tokens = highlightMath(source);
  assert.equal(tokens.map(t => t.text).join(''), source);
  assert.ok(tokens.some(t => t.kind === 'command'));
  assert.ok(tokens.some(t => t.kind === 'comment'));
});

test('math input rules insert equations, preserve preceding text and protect trailing text', () => {
  const schema = getSchema(getExtensions());
  function apply(text: string, block = false, cursor = text.length) {
    const doc = schema.node('doc', null, [schema.node('paragraph', null, text ? schema.text(text) : undefined)]);
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, cursor + 1) });
    const transaction = state.tr;
    const chained = createChainableState({ state, transaction });
    const rules = block ? [blockMathInputRule(schema.nodes.mathBlock)] : inlineMathInputRules(schema.nodes.inlineMath);
    const input = text.slice(0, cursor) + ' ';
    for (const rule of rules) {
      const match = (rule.find as RegExp).exec(input);
      if (match) {
        rule.handler({ state: chained, range: { from: 1 + match.index, to: cursor + 1 }, match } as any);
        break;
      }
    }
    return transaction;
  }
  const inline = apply('Before $$x^2$$');
  assert.equal(inline.doc.firstChild?.firstChild?.text, 'Before ');
  assert.equal(inline.doc.firstChild?.child(1)?.type.name, 'inlineMath');
  assert.equal(inline.doc.firstChild?.child(1)?.attrs.latex, 'x^2');
  assert.equal(inline.doc.firstChild?.lastChild?.text, ' ');
  assert.equal(inline.selection.from, 10);
  const empty = apply('$$');
  assert.equal(empty.selection.node?.type.name, 'inlineMath');
  assert.equal(empty.doc.firstChild?.firstChild?.attrs.latex, '');
  assert.equal(apply('$$$$', true).doc.firstChild?.type.name, 'mathBlock');
  assert.equal(apply('$$$$keep', true, 4).doc.textContent, '$$$$keep');
  assert.equal(apply('$$$$').doc.textContent, '$$$$');
});

import { EditorState, TextSelection, NodeSelection } from '@tiptap/pm/state';
import { history, undo } from '@tiptap/pm/history';
import { documentBlocks, moveBlockTransaction, siblingDestination, selectedBlock, BLOCK_TYPES } from '../src/extensions/block-movement';
const movementSchema = getSchema(getExtensions());
const movementParagraph = (id: string, text: string) => movementSchema.node('paragraph', { blockId: id }, movementSchema.text(text));
const movementState = () => EditorState.create({ schema: movementSchema, doc: movementSchema.node('doc', null, [movementParagraph('a', 'Alpha'), movementParagraph('b', 'Beta'), movementParagraph('c', 'Gamma')]), plugins: [history()] });
const blockOrder = (state: EditorState) => documentBlocks(state.doc).map(b => b.id);

test('block moves in both directions preserve identity, content, and a single undo step', () => {
  let state = movementState();
  const original = state.doc.toJSON();
  state = state.apply(moveBlockTransaction(state, 'a', { id: 'c', side: 'after' })!);
  assert.deepEqual(blockOrder(state), ['b', 'c', 'a']);
  state.doc.check();
  assert.ok(undo(state, tr => { state = state.apply(tr); }));
  assert.deepEqual(state.doc.toJSON(), original);
  state = state.apply(moveBlockTransaction(state, 'c', { id: 'a', side: 'before' })!);
  assert.deepEqual(blockOrder(state), ['c', 'a', 'b']);
});

test('block move retains text cursor and reverse selection offsets within the moved block', () => {
  for (const [anchor, head] of [[2, 2], [5, 2]]) {
    let state = movementState();
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, anchor, head)));
    state = state.apply(moveBlockTransaction(state, 'a', { id: 'c', side: 'after' })!);
    const source = documentBlocks(state.doc).find(b => b.id === 'a')!;
    assert.equal(state.selection.anchor - source.pos, anchor);
    assert.equal(state.selection.head - source.pos, head);
  }
});

test('drag commit selects the entire moved block', () => {
  let state = movementState();
  state = state.apply(moveBlockTransaction(state, 'c', { id: 'a', side: 'before' }, BLOCK_TYPES, true)!);
  assert.ok(state.selection instanceof NodeSelection);
  assert.equal(state.selection.node.attrs.blockId, 'c');
});

test('source edits and size changes made during a drag are retained with neighboring content intact', () => {
  let state = movementState();
  state = state.apply(state.tr.insertText(' remote edit', 6));
  const current = state.doc.firstChild!.toJSON();
  state = state.apply(moveBlockTransaction(state, 'a', { id: 'c', side: 'after' })!);
  assert.deepEqual(state.doc.lastChild!.toJSON(), current);
  assert.deepEqual(documentBlocks(state.doc).map(b => b.node.textContent), ['Beta', 'Gamma', 'Alpha remote edit']);
});

test('deleted source/target, self drops and adjacent no-op boundaries do not mutate the document', () => {
  const state = movementState();
  for (const [source, id, side] of [['missing', 'b', 'before'], ['a', 'missing', 'after'], ['a', 'a', 'after'], ['a', 'b', 'before'], ['c', 'b', 'after']] as const) {
    assert.equal(moveBlockTransaction(state, source, { id, side }), null);
  }
});

test('move commands expose disabled boundaries and identify the root container from nested selection', () => {
  const state = movementState();
  assert.equal(siblingDestination(state, 'a', -1), null);
  assert.equal(siblingDestination(state, 'c', 1), null);
  const quote = movementSchema.node('blockquote', { blockId: 'quote' }, movementParagraph('inner', 'Nested'));
  const nested = EditorState.create({ schema: movementSchema, doc: movementSchema.node('doc', null, [quote, movementParagraph('next', 'Next')]) });
  assert.equal(selectedBlock(nested)?.id, 'quote');
  assert.deepEqual(documentBlocks(nested.doc).map(b => b.id), ['quote', 'next']);
});

test('moving table as an atomic root operation preserves header cells and nested identities', () => {
  const cell = movementSchema.node('tableHeader', null, movementParagraph('cell', 'Header'));
  const table = movementSchema.node('table', { blockId: 'table' }, movementSchema.node('tableRow', null, [cell, cell]));
  let state = EditorState.create({ schema: movementSchema, doc: movementSchema.node('doc', null, [table, movementParagraph('next', 'Next')]) });
  state = state.apply(moveBlockTransaction(state, 'table', { id: 'next', side: 'after' })!);
  state.doc.check();
  assert.deepEqual(state.doc.lastChild!.toJSON(), table.toJSON());
});

test('atom targets and all registered schema blocks support root movement without DOM assumptions', () => {
  for (const type of BLOCK_TYPES) {
    const nodeType = movementSchema.nodes[type];
    if (!nodeType) continue;
    const node = nodeType.createAndFill({ blockId: 'target' });
    if (!node) continue;
    const state = EditorState.create({ schema: movementSchema, doc: movementSchema.node('doc', null, [movementParagraph('a', 'Move'), node]) });
    const tr = moveBlockTransaction(state, 'a', { id: 'target', side: 'after' });
    assert.ok(tr, type);
    tr.doc.check();
    assert.equal(tr.doc.firstChild!.attrs.blockId, 'target', type);
  }
});

import { normalizeBlockIds } from '../src/extensions/block-id';
test('pasted/split legacy duplicate IDs are repaired without changing text or the first identity', () => {
  let state = EditorState.create({ schema: movementSchema, doc: movementSchema.node('doc', null, [movementParagraph('duplicate', 'First'), movementParagraph('duplicate', 'Second'), movementParagraph('duplicate', 'Third')]) });
  assert.equal(moveBlockTransaction(state, 'duplicate', { id: 'duplicate', side: 'after' }), null);
  const content = state.doc.textContent;
  state = state.apply(normalizeBlockIds(state)!);
  const ids = blockOrder(state);
  assert.equal(ids[0], 'duplicate');
  assert.equal(new Set(ids).size, 3);
  assert.equal(state.doc.textContent, content);
  assert.equal(normalizeBlockIds(state), null);
  state = state.apply(moveBlockTransaction(state, ids[1], { id: ids[2], side: 'after' })!);
  assert.deepEqual(documentBlocks(state.doc).map(b => b.node.textContent), ['First', 'Third', 'Second']);
});

test('collaboration supplied by a UI integration disables competing StarterKit history', () => {
  const supplied = Extension.create({ name: 'collaboration' });
  const direct = getExtensions({ additionalExtensions: [supplied] });
  assert.ok(!names(direct).includes('undoRedo'));
  const kit = Extension.create({ name: 'collaborationKit', addExtensions: () => [supplied] });
  assert.ok(!names(getExtensions({ additionalExtensions: [kit] })).includes('undoRedo'));
});

// Code editing regressions: selections span logical lines, not arbitrary text fragments.
import { indentCode, filterLanguages, htmlPreview } from '../src/components/codeblock/codeBlockUtils';
import { MAX_MERMAID_SOURCE_LENGTH, renderMermaid } from '../src/components/codeblock/mermaidRenderer';
import { EditorState as CodeEditorState, TextSelection as CodeTextSelection } from '@tiptap/pm/state';
const codeState = (text: string, from: number, to = from) => {
  const schema = getSchema(getExtensions());
  const doc = schema.node('doc', null, [schema.node('codeBlock', { language: 'javascript' }, text ? schema.text(text) : undefined)]);
  return CodeEditorState.create({ doc, selection: CodeTextSelection.create(doc, from, to) });
};
test('code indentation changes complete lines and excludes a trailing selected line boundary', () => {
  const state = codeState('alpha\nbeta\ngamma', 3, 12);
  const tr = indentCode(state)!;
  assert.equal(tr.doc.textContent, '  alpha\n  beta\ngamma');
  assert.equal(tr.doc.textBetween(tr.selection.from, tr.selection.to), 'pha\n  beta\n');
  const reversed = indentCode(CodeEditorState.create({ doc: tr.doc, selection: tr.selection }), true)!;
  assert.equal(reversed.doc.textContent, state.doc.textContent);
  assert.equal(reversed.selection.from, state.selection.from);
  assert.equal(reversed.selection.to, state.selection.to);
});
test('code indentation handles empty first lines, blank blocks, tabs and reverse selections', () => {
  assert.equal(indentCode(codeState('\nnext', 1))!.doc.textContent, '  \nnext');
  assert.equal(indentCode(codeState('', 1))!.doc.textContent, '  ');
  assert.equal(indentCode(codeState('\talpha\n beta', 1, 12), true)!.doc.textContent, 'alpha\nbeta');
  const state = codeState('alpha\nbeta', 10, 2);
  const tr = indentCode(state)!;
  assert.ok(tr.selection.anchor > tr.selection.head);
  assert.equal(tr.doc.textContent, '  alpha\n  beta');
});
test('language search resolves common aliases and ignores invalid recent values', () => {
  assert.ok(filterLanguages('html', []).includes('xml'));
  assert.ok(filterLanguages('js', []).includes('javascript'));
  assert.ok(filterLanguages('mermaid', []).includes('mermaid'));
  assert.equal(filterLanguages('', ['python', 'invalid', 'python'])[0], 'python');
  assert.ok(!filterLanguages('', ['invalid']).includes('invalid'));
  assert.deepEqual(filterLanguages('no-such-language', []), []);
});
test('code display attributes preserve defaults and persisted values', () => {
  const schema = getSchema(getExtensions());
  const plain = schema.nodes.codeBlock.create();
  assert.equal(plain.attrs.wrap, false);
  assert.equal(plain.attrs.lineNumbers, false);
  const code = schema.nodes.codeBlock.create({ caption: 'sample.ts', wrap: true, lineNumbers: true, collapsed: true }, schema.text('const a = 1;'));
  assert.deepEqual(schema.nodeFromJSON(code.toJSON()).attrs, code.attrs);
});
test('HTML preview establishes restrictive CSP before user markup', () => {
  const preview = htmlPreview('<script>alert(1)</script>');
  assert.ok(preview.includes("script-src 'none'"));
  assert.ok(preview.includes("form-action 'none'"));
  assert.ok(preview.indexOf('Content-Security-Policy') < preview.indexOf('<script>'));
});
test('oversized Mermaid source is rejected before the renderer loads', async () => {
  await assert.rejects(
    renderMermaid(' '.repeat(MAX_MERMAID_SOURCE_LENGTH + 1), 'default', new AbortController().signal),
    /too large to preview/,
  );
});

test('code keyboard priority does not change the default paragraph schema', () => {
  const schema = getSchema(getExtensions());
  assert.equal(schema.topNodeType.createAndFill()!.firstChild!.type.name, 'paragraph');
});

// Attachment handlers are a runtime boundary: bad responses must never become ready chips.
import { attachmentResultAttrs, applyAttachmentUploadSuccess, applyAttachmentUploadError, registerPendingAttachmentFile, getPendingAttachmentFile } from '../src/extensions/attachment-upload';
import type { AttachmentAPIHandler, AttachmentUploadResult } from '../src/types';
const attachmentResult: AttachmentUploadResult = { attachmentId: 'a1', url: '/api/v1/attachments/a1', fileName: 'report.pdf', mimeType: 'application/pdf', fileSize: 123 };
const attachmentHandler: AttachmentAPIHandler = { uploadAttachment: async () => attachmentResult };

test('attachment contract rejects incomplete responses and unsafe URLs', () => {
  for (const patch of [{ attachmentId: '' }, { fileName: '' }, { mimeType: '' }, { fileSize: -1 }, { fileSize: NaN }, { url: '' }, { url: 'javascript:alert(1)' }]) {
    assert.throws(() => attachmentResultAttrs({ ...attachmentResult, ...patch }, attachmentHandler));
  }
  const attrs = attachmentResultAttrs(attachmentResult, { ...attachmentHandler, getAttachmentUrl: (url) => `https://files.example.com${url}` });
  assert.equal(attrs.fileUrl, 'https://files.example.com/api/v1/attachments/a1');
  assert.equal(attrs.uploadStatus, 'success');
  assert.equal(attrs.placeholderId, '');
});

test('attachment upload completion does not mutate a read-only or destroyed view', () => {
  for (const flags of [{ editable: false, isDestroyed: false }, { editable: true, isDestroyed: true }]) {
    const view = { ...flags, get state() { throw new Error('must not read a stopped view'); } } as any;
    applyAttachmentUploadSuccess(view, 'stopped-upload', attachmentResult, attachmentHandler);
    applyAttachmentUploadError(view, 'stopped-upload', 'Failed');
  }
});

test('failed attachment validation preserves the local file for retry', () => {
  const file = new File(['test'], 'report.pdf', { type: 'application/pdf' });
  registerPendingAttachmentFile('retry-contract', file);
  const view = { isDestroyed: true } as any;
  assert.throws(() => applyAttachmentUploadSuccess(view, 'retry-contract', { ...attachmentResult, url: '' }, attachmentHandler));
  assert.equal(getPendingAttachmentFile('retry-contract'), file);
  applyAttachmentUploadSuccess(view, 'retry-contract', attachmentResult, attachmentHandler);
  assert.equal(getPendingAttachmentFile('retry-contract'), undefined);
});

import { addDaysToDateValue, addMonths, getCalendarMonthDays, isValidDateValue, parseDateValue, toLocalDateValue } from '../src/nodes/dateInlineUtils';

test('date arithmetic preserves calendar dates at leap, month, and year boundaries', () => {
  assert.equal(addDaysToDateValue('2024-02-28', 1), '2024-02-29');
  assert.equal(addDaysToDateValue('2024-02-29', 1), '2024-03-01');
  assert.equal(addDaysToDateValue('2026-12-31', 1), '2027-01-01');
  assert.equal(addDaysToDateValue('2026-03-01', -1), '2026-02-28');
  assert.equal(isValidDateValue('2026-02-29'), false);
  assert.equal(isValidDateValue('0000-01-01'), false);
  for (const value of ['0001-01-01', '0099-12-31', '0100-02-28', '9999-12-31']) {
    assert.equal(isValidDateValue(value), true);
    assert.equal(toLocalDateValue(parseDateValue(value)!), value);
  }
  const february = addMonths(parseDateValue('0004-01-31')!, 1);
  const days = getCalendarMonthDays(february).filter(Boolean);
  assert.equal(days.length, 29);
  assert.equal(toLocalDateValue(days[28]!), '0004-02-29');
});


import { formatDateLabel, formatRelativeDateLabel } from '../src/nodes/dateInlineUtils';

test('relative date labels follow the current calendar day without changing the date', () => {
  const date = '2027-01-01';
  assert.equal(formatRelativeDateLabel(date, '2026-12-31'), 'Tomorrow');
  assert.equal(formatRelativeDateLabel(date, '2027-01-01'), 'Today');
  assert.equal(formatRelativeDateLabel(date, '2027-01-02'), 'Yesterday');
  assert.equal(formatRelativeDateLabel(date, '2027-01-03'), formatDateLabel(date));
  assert.equal(formatRelativeDateLabel('2024-02-29', '2024-03-01'), 'Yesterday');
  assert.equal(formatRelativeDateLabel('2024-03-01', '2024-02-29'), 'Tomorrow');
  assert.equal(formatRelativeDateLabel('2026-03-09', '2026-03-08'), 'Tomorrow');
  assert.equal(formatRelativeDateLabel('invalid', '2026-09-20'), 'Invalid date');
});

test('mentions retain durable references without a handler and gate insertion by editability', () => {
  const user = { id: 'user-1', label: 'Mock User' };
  const mentionHandler = { searchUsers: async () => [user], resolveUser: async () => user };
  const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'mention', attrs: user }] }] };
  for (const editable of [true, false]) {
    const editor = new Editor({ element: null, editable, extensions: getExtensions({ mentionHandler }), content });
    assert.equal(editor.getJSON().content![0].content![0].attrs!.id, user.id);
    assert.equal(editor.getText(), '@Mock User');
    const before = editor.getJSON();
    assert.equal(editor.commands.insertMention(user), editable);
    if (!editable) assert.deepEqual(editor.getJSON(), before);
    editor.destroy();
  }
  const editor = new Editor({ element: null, extensions: getExtensions(), content });
  assert.equal(editor.getText(), '@Mock User');
  assert.equal(editor.commands.insertMention(user), false);
  editor.destroy();
});

// Internal references must retain target identity across both representations.
import { parseInternalResourceUrl } from '../src/nodes/internalDocumentUrl';
import { resourceContext, resourceHref } from '../src/components/internal-link/useInternalResource';

test('internal URL parsing preserves space, query and fragment and rejects foreign/unsafe origins', () => {
  const base = 'https://beskar.example';
  assert.deepEqual(parseInternalResourceUrl('/space/other/view/42?mode=x#section', base), {
    resourceId: '42', resourceType: 'document', spaceId: 'other', href: `${base}/space/other/view/42?mode=x#section`,
  });
  assert.equal(parseInternalResourceUrl('/space/other/whiteboard/7', base)?.resourceType, 'whiteboard');
  for (const url of ['javascript:alert(1)', 'https://foreign.example/space/other/view/42', '/space/other/view/%']) {
    assert.equal(parseInternalResourceUrl(url, base), null);
  }
});

test('both internal schemas retain canonical context and legacy references remain valid', () => {
  const schema = getSchema(getExtensions());
  for (const name of ['internalDocInline', 'internalLinkBlock']) {
    const attrs = { resourceId: '42', resourceType: 'document', spaceId: 'other', href: 'https://beskar.example/space/other/view/42#anchor' };
    const node = schema.nodes[name].create(attrs);
    assert.equal(schema.nodeFromJSON(node.toJSON()).attrs.href, attrs.href);
    assert.equal(schema.nodeFromJSON(node.toJSON()).attrs.spaceId, 'other');
    schema.nodes[name].create({ resourceId: '42' }).check();
  }
});

test('legacy hrefs supply target space while persisted unsafe URLs cannot become navigation links', () => {
  const handler = { appBaseUrl: 'https://beskar.example', getResourceUrl: (id: string) => `https://beskar.example/docs/${id}` } as any;
  const ref = { resourceId: '42', resourceType: 'document' as const, href: 'https://beskar.example/space/other/view/42#anchor' };
  assert.equal(resourceContext(ref, handler).spaceId, 'other');
  assert.equal(resourceHref(ref, handler), ref.href);
  assert.equal(resourceHref({ ...ref, href: 'javascript:alert(1)' }, handler), 'https://beskar.example/docs/42');
});

import { InlineMath } from '../src/extensions/math-inline';

test('inline math insertion opens a blank equation or converts selection without touching neighboring text', () => {
  const schema = getSchema(getExtensions());
  const doc = schema.node('doc', null, [schema.node('paragraph', null, schema.text('Before x^2 after.')), schema.node('paragraph', null, schema.text('Keep me'))]);
  const commands = InlineMath.config.addCommands!.call({ name: 'inlineMath', type: schema.nodes.inlineMath } as any);
  for (const to of [8, 11]) {
    let state = EditorState.create({ doc, selection: TextSelection.create(doc, 8, to), plugins: [history()] });
    const tr = state.tr;
    assert.equal(commands.insertInlineMath()({ state, tr, dispatch: () => {} } as any), true);
    state = state.apply(tr);
    assert.equal(state.selection instanceof NodeSelection, true);
    assert.equal(state.selection.from, 8);
    assert.equal((state.selection as NodeSelection).node.attrs.latex, to === 8 ? '' : 'x^2');
    // Simulate saving and resuming typing at the right edge of the atom.
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 9)).insertText(' new '));
    assert.equal(state.doc.firstChild!.textContent, to === 8 ? 'Before  new x^2 after.' : 'Before  new  after.');
    assert.equal(state.doc.lastChild!.textContent, 'Keep me');
    assert.ok(undo(state, t => { state = state.apply(t); }));
    assert.deepEqual(state.doc.toJSON(), doc.toJSON());
  }
  const state = EditorState.create({ doc, selection: TextSelection.create(doc, 8, 22) });
  const tr = state.tr;
  assert.equal(commands.insertInlineMath()({ state, tr, dispatch: () => {} } as any), false);
  assert.equal(tr.docChanged, false);
});

test('inline math slash action is available within paragraphs', () => {
  const action = GROUPS.flatMap(group => group.commands).find(command => command.name === 'inlineMath');
  assert.ok(action);
  assert.deepEqual(action.requiredNodes, ['inlineMath']);
  assert.ok(!action.blockOnly);
  assert.ok(action.aliases?.includes('equation'));
});

test('typing space after a rendered equation never reinterprets its serialized delimiters', () => {
  const schema = getSchema(getExtensions());
  for (const latex of ['x^2', '', 'a very long formula']) {
    const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('Before '), schema.node('inlineMath', { latex }), schema.text(' after')])]);
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 9) });
    const transaction = state.tr;
    const chained = createChainableState({ state, transaction });
    const before = `Before $$${latex}$$ `;
    for (const rule of inlineMathInputRules(schema.nodes.inlineMath)) {
      const match = (rule.find as RegExp).exec(before);
      if (!match) continue;
      const result = rule.handler({ state: chained, range: { from: 9 - (match[0].length - 1), to: 9 }, match } as any);
      assert.equal(result, null);
      assert.equal(transaction.docChanged, false);
      assert.deepEqual(transaction.doc.toJSON(), doc.toJSON());
    }
  }
});
