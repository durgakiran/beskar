import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Theme } from '@radix-ui/themes';
import '@radix-ui/themes/styles.css';
import '../dist/styles.css';
import '../dist/index.css';
import { Editor, TextFormattingMenu } from '../dist/index.mjs';
function App() {
 const [editor, setEditor] = useState<any>(null);
 const [json, setJson] = useState('');
 return <Theme><main style={{padding:40,maxWidth:800,margin:'auto'}}>
  <h1>Inline equation regression</h1>
  <p>Type $$ then Space, use Mod+Shift+M, or type /inline.</p>
  <Editor initialContent={{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Before '},{type:'inlineMath',attrs:{latex:'x^2'}},{type:'text',text:' after. Keep this text.'}]},{type:'paragraph',content:[{type:'text',text:'Unrelated paragraph stays unchanged.'}]},{type:'paragraph'}]}} onReady={setEditor}/>
  {editor && <TextFormattingMenu editor={editor}/>}
  <button onClick={()=>editor.chain().setContent({type:'doc',content:[{type:'paragraph'}]}).focus('end').run()}>Reset blank</button>
  <button onClick={()=>editor.chain().setContent({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Before x^2 after.'}]}]}).setTextSelection({from:8,to:11}).focus().run()}>Select source</button>
  <button onClick={()=>setJson(JSON.stringify({selection:editor.state.selection.toJSON(),doc:editor.getJSON()},null,2))}>Inspect document</button>
  <pre style={{whiteSpace:'pre-wrap'}}>{json}</pre>
 </main></Theme>;
}
createRoot(document.getElementById('root')!).render(<App/>);
