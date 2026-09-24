import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Theme } from '@radix-ui/themes';
import '@radix-ui/themes/styles.css';
import '../dist/styles.css?v=6';
import '../dist/index.css';
import { Editor } from '../dist/index.mjs?v=5';
const large = String.raw`\begin{aligned}F(x)&=\sum_{n=0}^{\infty}\frac{x^n}{n!}+\underbrace{a_1+a_2+a_3+a_4+a_5+a_6+a_7+a_8+a_9+a_{10}+a_{11}+a_{12}}_{\text{a deliberately wide expression}}\\G(x)&=\left(\frac{\frac{x^2+1}{x-1}}{\sqrt{1+\frac{1}{x^2}}}\right)^2\end{aligned}`;
const block = (latex = large) => ({ type: 'mathBlock', attrs: { latex, displayMode: true } });
const para = (content: any[]) => ({ type:'paragraph', content });
const sample = { type:'doc', content:[block(), para([{type:'text',text:'Inline: '},{type:'inlineMath',attrs:{latex:large}},{type:'text',text:' after.'}]),
  block(''), block('\\frac{'),
  {type:'columns',content:[{type:'column',content:[block()]},{type:'column',content:[block()]}]},
  {type:'table',content:[{type:'tableRow',content:[{type:'tableCell',content:[block()]},{type:'tableCell',content:[para([{type:'text',text:'Cell'}])]}]}]},
] };
const editors: any[] = [];
function App() {
 const [dark,setDark]=useState(false); const [narrow,setNarrow]=useState(false); const [result,setResult]=useState('Not checked');
 return <Theme appearance={dark?'dark':'light'}><main style={{padding:24}}>
  <h1>Math regression</h1><button onClick={()=>setDark(!dark)}>Toggle theme</button><button onClick={()=>setNarrow(!narrow)}>Toggle narrow</button>
  <button onClick={()=>{
   const checks = Array.from(document.querySelectorAll<HTMLElement>('[data-math-fixture]')).map(el=>({
    name:el.dataset.mathFixture, width:el.clientWidth, scrollWidth:el.scrollWidth,
    contained:el.scrollWidth<=el.clientWidth+2,
    equations:Array.from(el.querySelectorAll<HTMLElement>('.math-scroll')).map(s=>({width:s.clientWidth,scroll:s.scrollWidth,scrollable:getComputedStyle(s).overflowX==='auto'})),
    invalid:!!el.querySelector('.math-error'),empty:Array.from(el.querySelectorAll('.math-placeholder')).some(p=>p.textContent==='Equation'),
   }));setResult(JSON.stringify(checks,null,2));
  }}>Check layout</button>
  <button onClick={()=>{editors[0].commands.command(({tr,dispatch}:any)=>{if(dispatch)dispatch(tr.setNodeMarkup(0,undefined,{...tr.doc.nodeAt(0).attrs,latex:'z^7'}));return true;});}}>Apply external update</button>
  <button onClick={()=>editors[0].commands.undo()}>Undo equation update</button>
  <button onClick={()=>setResult(JSON.stringify(editors[0].getJSON().content[0].attrs))}>Check saved formula</button>
  <pre style={{whiteSpace:'pre-wrap',maxHeight:120,overflow:'auto'}}>{result}</pre>
  <div style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:24}}>
  {['Package edit','Package view','UI edit','Published view'].map((label,i)=><section key={label} data-math-fixture={label} style={{minWidth:0,width:narrow?280:undefined,maxWidth:'100%',border:'1px solid gray',boxSizing:'border-box'}}>
  <h2>{label}</h2><div style={i>=2?{'--editor-line-height':'1.625'} as React.CSSProperties:undefined}><Editor initialContent={sample} editable={i%2===0} onReady={e=>editors[i]=e}/></div></section>)}
  </div><h2>Typing shortcut sandbox</h2><Editor initialContent={{type:'doc',content:[{type:'paragraph'}]}}/>
 </main></Theme>;
}
createRoot(document.getElementById('root')!).render(<App/>);
