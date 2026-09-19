// Playwright CLI run-code body; run against tests/code-blocks.html after a fresh build.
async(page)=>{
const assert=(v,m)=>{if(!v)throw new Error(m)};
const edit=page.locator('[data-fixture="edit"]');
await page.evaluate(()=>{const e=window.codeEditor;window.codeSavedJSON=e.getJSON();const before=e.getJSON();e.commands.setContent(e.getHTML());window.roundTrip={before,after:e.getJSON()};});
assert(await page.evaluate(()=>{const codes=d=>{const out=[];const walk=n=>{if(n.type==='codeBlock')out.push({text:n.content,language:n.attrs.language,wrap:n.attrs.wrap,lineNumbers:n.attrs.lineNumbers,collapsed:n.attrs.collapsed,caption:n.attrs.caption});n.content?.forEach(walk)};walk(d);return JSON.stringify(out)};return codes(window.roundTrip.before)===codes(window.roundTrip.after)}),'HTML round trip');
for(const container of ['table','columns']){
await page.evaluate(kind=>{const e=window.codeEditor;let at; e.state.doc.descendants((n,p)=>{if(n.type.name==='codeBlock' && e.state.doc.resolve(p).path.some(x=>x?.type?.name===kind))at=p+1;});if(at===undefined)throw Error('nested code missing');e.commands.setTextSelection(at);e.view.focus();window.nestedBefore=e.state.doc.textContent;window.nestedAt=at;},container);
await page.keyboard.press('Tab');
assert(await page.evaluate(()=>window.codeEditor.state.doc.textContent!==window.nestedBefore),'nested '+container+' Tab');
await page.keyboard.press('Shift+Tab');
assert(await page.evaluate(()=>window.codeEditor.state.doc.textContent===window.nestedBefore),'nested '+container+' outdent');
}
const first=edit.locator('.code-block-view').first();
await first.locator('pre').click();
await page.evaluate(()=>{const e=window.codeEditor;const p=e.state.doc.child(0).nodeSize+1;e.commands.setTextSelection({from:p+1,to:p+8});window.savedSelection=e.state.selection.toJSON()});
await first.getByRole('button',{name:'Copy code'}).click();
assert(await page.evaluate(()=>JSON.stringify(window.savedSelection)===JSON.stringify(window.codeEditor.state.selection.toJSON())),'copy preserves selection');
await page.evaluate(()=>{window.originalExec=document.execCommand;Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:async()=>{throw Error('test denied')}});document.execCommand=()=>false});
await first.getByRole('button',{name:'Copy code'}).click();
await first.getByText('Copy failed. Select the code and copy manually.').waitFor();
await page.evaluate(()=>{delete navigator.clipboard.writeText;document.execCommand=window.originalExec});
await first.getByRole('button',{name:'Code block options'}).click();
await page.getByRole('menuitem',{name:'Delete',exact:true}).click();
assert(await edit.locator('.code-block-view').count()===5,'delete code');
await page.evaluate(()=>window.codeEditor.commands.undo());
assert(await edit.locator('.code-block-view').count()===6,'undo deletion');
await first.locator('pre').click();
await page.evaluate(()=>{const e=window.codeEditor;let p=e.state.doc.child(0).nodeSize+1;e.commands.setTextSelection(p);e.view.focus()});
await page.keyboard.press('ControlOrMeta+Enter');
assert(await page.evaluate(()=>window.codeEditor.state.selection.$from.parent.type.name==='paragraph'),'exit code shortcut');
await page.evaluate(()=>{const e=window.codeReader;window.readerBefore=JSON.stringify(e.getJSON());let p=e.state.doc.child(0).nodeSize+1;e.commands.setTextSelection(p);e.view.focus()});
await page.keyboard.press('Tab');
assert(await page.evaluate(()=>JSON.stringify(window.codeReader.getJSON())===window.readerBefore),'read-only keyboard cannot mutate');
await page.getByRole('button',{name:'Toggle editability'}).click();
await page.waitForFunction(()=>!window.codeEditor.isEditable && document.querySelector('[data-fixture=edit] .code-block-language').disabled);
await page.getByRole('button',{name:'Toggle editability'}).click();
await page.waitForFunction(()=>window.codeEditor.isEditable && !document.querySelector('[data-fixture=edit] .code-block-language').disabled);
await page.getByRole('button',{name:'Toggle dark theme'}).click();
await page.locator('.radix-themes.dark').waitFor();
await first.getByRole('button',{name:'Copy code'}).click();
await page.screenshot({path:'output/playwright/code-block-package-dark.png'});
await page.setViewportSize({width:390,height:844});
await edit.locator('.code-block-view').first().scrollIntoViewIfNeeded();
await edit.locator('.code-block-view').first().getByRole('button',{name:/Code language:/}).click();
await page.getByRole('combobox',{name:'Search languages'}).fill('html');
await page.screenshot({path:'output/playwright/code-block-package-mobile.png'});
assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal page overflow');
await page.keyboard.press('Escape');
await page.setViewportSize({width:1200,height:900});
await page.evaluate(()=>window.codeEdgeResults='PASS: HTML round trip, nested table/column indentation, copy preserves selection, clipboard denial feedback, delete/undo, exit shortcut, reader keyboard guard, dark and 390px layout');
}
