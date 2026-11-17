// Playwright CLI run-code body; run against tests/code-blocks.html after a fresh build.
async (page) => {
const assert=(v,m)=>{if(!v)throw new Error(m)};
await page.context().grantPermissions(['clipboard-read','clipboard-write']);
const edit=page.locator('[data-fixture="edit"]'),first=edit.locator('.code-block-view').first();
await first.getByRole('button',{name:'Code language: JavaScript',exact:true}).click();
await page.getByRole('combobox',{name:'Search languages'}).fill('ts');
await page.keyboard.press('Enter');
assert(await first.getByRole('button',{name:'Code language: TypeScript'}).count()===1,'language keyboard selection');
await first.getByRole('button',{name:'Copy code',exact:true}).click();
assert(await page.evaluate(()=>navigator.clipboard.readText())==='const greeting = "Hello";\nconsole.log(greeting);','copy full code');
await first.getByRole('button',{name:'Code block options'}).click();
await page.getByRole('menuitem',{name:'Edit caption'}).click();
await page.getByLabel('Caption',{exact:true}).fill('sample.ts');
await page.getByRole('button',{name:'Save',exact:true}).click();
assert(await first.locator('.code-block-caption').innerText()==='sample.ts','caption saves');
await first.getByRole('button',{name:'Code block options'}).click();
await page.getByRole('menuitemcheckbox',{name:'Wrap lines'}).click();
await first.getByRole('button',{name:'Code block options'}).click();
await page.getByRole('menuitemcheckbox',{name:'Line numbers'}).click();
assert(await first.getAttribute('class').then(s=>s.includes('is-wrapped')&&s.includes('has-line-numbers')),'options applied');
await first.getByRole('button',{name:'Code block options'}).click();
await page.getByRole('menuitem',{name:'Duplicate',exact:true}).click();
assert(await edit.locator('.code-block-view').count()===6,'duplicate');
const ids=await edit.locator('.code-block-view').evaluateAll(nodes=>nodes.map(n=>n.dataset.blockId));
assert(new Set(ids).size===ids.length,'duplicate unique identity');
await first.locator('pre').click();
await page.evaluate(()=>{const e=window.codeEditor;const pos=e.state.doc.child(0).nodeSize+1;e.commands.setTextSelection({from:pos+3,to:pos+30});e.view.focus();window.beforeCode=e.state.doc.child(1).textContent});
await page.keyboard.press('Tab');
assert(await page.evaluate(()=>window.codeEditor.state.doc.child(1).textContent.startsWith('  const')),'tab whole line indent');
await page.keyboard.press('Shift+Tab');
assert(await page.evaluate(()=>window.codeEditor.state.doc.child(1).textContent===window.beforeCode),'shift-tab restores');
await page.keyboard.press('Escape');
assert(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')?.startsWith('Code language')),'escape reaches toolbar');
await first.getByRole('button',{name:'Collapse',exact:true}).click();
assert((await first.getAttribute('class')).includes('is-collapsed'),'collapse');
await first.getByRole('button',{name:'Expand',exact:true}).click();
const reader=page.locator('[data-fixture="view"]');
const saved=await page.evaluate(()=>JSON.stringify(window.codeReader.getJSON()));
await reader.locator('.code-block-view').first().getByRole('button',{name:'Collapse',exact:true}).click();
await reader.locator('.code-block-view').first().getByRole('button',{name:'Copy code',exact:true}).click();
await reader.locator('.code-block-view').first().getByRole('button',{name:'Code block options'}).click();
assert(await page.getByRole('menuitem',{name:'Delete',exact:true}).count()===0,'reader cannot delete');
await page.getByRole('menuitemcheckbox',{name:'Wrap lines'}).click();
assert(saved===await page.evaluate(()=>JSON.stringify(window.codeReader.getJSON())),'reader options never mutate document');
await reader.getByRole('button',{name:'Preview',exact:true}).click();
assert(await reader.frameLocator('iframe').getByRole('heading',{name:'Hello preview'}).isVisible(),'HTML preview');
await page.evaluate(() => {
  const diagram = (direction, count) => ({
    type: 'codeBlock',
    attrs: { language: 'mermaid' },
    content: [{
      type: 'text',
      text: `flowchart ${direction}\n  ` + Array.from({ length: count }, (_, i) => `N${i}[Step ${i + 1}]`).join(' --> '),
    }],
  });
  window.codeEditor.commands.setContent({ type: 'doc', content: [diagram('TD', 45), diagram('LR', 18)] });
});
for (const [index, orientation] of ['tall', 'wide'].entries()) {
  const block = edit.locator('.code-block-view').nth(index);
  await block.getByRole('button', { name: 'Preview', exact: true }).click();
  const image = block.locator('.mermaid-inline-frame img');
  await image.evaluate(img => img.decode());
  await block.getByRole('button', { name: 'Open diagram' }).waitFor();
  const fits = await image.evaluate(img => {
    const bounds = img.getBoundingClientRect();
    const frame = img.parentElement.getBoundingClientRect();
    const source = decodeURIComponent(img.getAttribute('src').split(',')[1]);
    const svg = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement;
    const [, , width, height] = svg.getAttribute('viewBox').trim().split(/\s+/).map(Number);
    return bounds.width > 0 && bounds.height > 0
      && bounds.width <= frame.width + 1 && bounds.height <= frame.height + 1
      && bounds.height <= Math.min(320, window.innerHeight * 0.45) + 1
      && Math.abs(bounds.width - bounds.height * width / height) < 2;
  });
  assert(fits, `${orientation} Mermaid diagram fits inline without clipping or distortion`);
}
await page.evaluate(() => {
  window.codeReader.commands.setContent(window.codeEditor.getJSON());
});
const readerDiagram = reader.locator('.code-block-view').first();
const readerSource = readerDiagram.locator('.code-block-source');
await readerDiagram.locator('.mermaid-inline-frame img').waitFor();
assert(!await readerSource.isVisible(), 'Mermaid opens in preview in a read-only editor');
await readerDiagram.getByRole('button', { name: 'Code', exact: true }).click();
assert(await readerSource.isVisible(), 'readers can switch to Mermaid source');
await readerDiagram.getByRole('button', { name: 'Preview', exact: true }).click();
assert(!await readerSource.isVisible(), 'readers can return to the diagram');
const editorDiagram = edit.locator('.code-block-view').first();
await editorDiagram.getByRole('button', { name: 'Code', exact: true }).click();
await page.getByRole('button', { name: 'Toggle editability' }).click();
await editorDiagram.getByRole('button', { name: 'Code', exact: true }).waitFor();
await editorDiagram.getByRole('button', { name: 'Code', exact: true }).click();
await page.getByRole('button', { name: 'Toggle editability' }).click();
await editorDiagram.getByRole('button', { name: 'Preview', exact: true }).waitFor();
assert(await editorDiagram.locator('.code-block-source').isVisible(), 'edit mode opens Mermaid source');
await page.getByRole('button', { name: 'Toggle editability' }).click();
await editorDiagram.getByRole('button', { name: 'Code', exact: true }).waitFor();
await page.evaluate(()=>{window.codeBrowserResults='PASS: language keyboard search, copy, caption, wrap, line numbers, duplicate and unique IDs, Tab/Shift-Tab, Escape, collapse, reader copy and immutable preferences, HTML preview, tall and wide Mermaid previews, and Mermaid view-mode defaults'});
}
