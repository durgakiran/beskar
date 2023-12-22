import Quill from 'quill';
import './editor.css';
import { Shortcut, ShortcutConfig } from './src/shortcut/shortcut';

const toolbarOptions = [
    ['bold', 'italic', 'underline', 'strike'],        // toggled buttons
    ['blockquote', 'code-block'],
  
    [{ 'header': 1 }, { 'header': 2 }],               // custom button values
    [{ 'list': 'ordered'}, { 'list': 'bullet' }],
    [{ 'script': 'sub'}, { 'script': 'super' }],      // superscript/subscript
    [{ 'indent': '-1'}, { 'indent': '+1' }],          // outdent/indent
    [{ 'direction': 'rtl' }],                         // text direction
  
    [{ 'size': ['small', false, 'large', 'huge'] }],  // custom dropdown
    [{ 'header': [1, 2, 3, 4, 5, 6, false] }],
  
    [{ 'color': [] }, { 'background': [] }],          // dropdown with defaults from theme
    [{ 'font': [] }],
    [{ 'align': [] }],
  
    ['clean']                                         // remove formatting button
  ];

// short cuts to the body of the document
const shortcutOptions: ShortcutConfig[] = [{ text: 'header', image: ''  }];
const shortcuts = new Shortcut(shortcutOptions);
document.body.appendChild(shortcuts.render());

const editor = new Quill('#editor', {
    modules: { toolbar: toolbarOptions},
    theme: 'snow',
});

// editor.on('text-change', (delta, oldContents) => { 
//     console.log(delta, oldContents);
//     const editorElement = document.getElementById('editor');
//     if (editorElement) {
//         const editorBounds = editorElement.getBoundingClientRect();
//         console.log(editorBounds);
//         for (const d of delta.ops) {
//             if (d.insert && d.insert === '/') {
//                 // TODO: getLine method instead of oldContents to get current line upto selected index
//                 for (const o of oldContents.ops) {
//                     if (o.insert && typeof o.insert === 'string' && /\s*\n$/.test(o.insert)) {
//                         const id = shortcuts.getId();
//                         const element = document.getElementById(id);
//                         const range = editor.getSelection();
//                         if (range) {
//                             const [line, offset] = editor.getLine(range?.index);
//                             if (line) {
//                                 const lineContents = editor.getContents(offset, line.length());
//                                 console.log(lineContents);
//                               }
//                             const bounds = editor.getBounds(range.index);
//                             console.log(bounds);
//                             if (element) {
//                                 // TODO: compare with viewport height before adding position style to place top to the element or bottom to the element
//                                 element.style.left = editorBounds.left + bounds.left + 'px';
//                                 element.style.top = editorBounds.top + bounds.top + 'px';
//                                 element.style.setProperty('--styled-overlay-visibility', 'visible');
//                             }
//                         }
    
//                     }
//                 }
//             }
//         }
//     }
// });

// When the user types space...
editor.keyboard.addBinding({ key: ' ' }, {
    collapsed: true,
    format: { list: false },  // ...on an line that's not already a list
    prefix: /^#$/,            // ...following a '-' character
    offset: 1,                // ...at the 1st position of the line,
                              // otherwise handler would trigger if the user
                              // typed hyphen+space mid sentence
  }, function(range, context) {
    editor.formatLine(range.index, 1, 'header', '1');
    editor.deleteText(range.index - 1, 1);
});
//Header 2
editor.keyboard.addBinding({ key: ' ' }, {
    collapsed: true,
    format: { list: false },  // ...on an line that's not already a list
    prefix: /^##$/,            // ...following a '-' character
    offset: 2,                // ...at the 1st position of the line,
                              // otherwise handler would trigger if the user
                              // typed hyphen+space mid sentence
  }, function(range, context) {
    const currentLine = editor.getLine(range.index);
    editor.formatLine(range.index, 1, 'header', '2');
    editor.deleteText(range.index - 2, 2);
});
//Header 3
editor.keyboard.addBinding({ key: ' ' }, {
    collapsed: true,
    format: { list: false },  // ...on an line that's not already a list
    prefix: /^###$/,            // ...following a '-' character
    offset: 3,                // ...at the 1st position of the line,
                              // otherwise handler would trigger if the user
                              // typed hyphen+space mid sentence
  }, function(range, context) {
    editor.formatLine(range.index, 1, 'header', '3');
    editor.deleteText(range.index - 3, 3);
});
//Header 4
editor.keyboard.addBinding({ key: ' ' }, {
    collapsed: true,
    format: { list: false },  // ...on an line that's not already a list
    prefix: /^####$/,            // ...following a '-' character
    offset: 4,                // ...at the 1st position of the line,
                              // otherwise handler would trigger if the user
                              // typed hyphen+space mid sentence
  }, function(range, context) {
    editor.formatLine(range.index, 1, 'header', '4');
    editor.deleteText(range.index - 4, 4);
});
//Header 5
editor.keyboard.addBinding({ key: ' ' }, {
    collapsed: true,
    format: { list: false },  // ...on an line that's not already a list
    prefix: /^#####$/,            // ...following a '-' character
    offset: 5,                // ...at the 1st position of the line,
                              // otherwise handler would trigger if the user
                              // typed hyphen+space mid sentence
  }, function(range, context) {
    editor.formatLine(range.index, 1, 'header', '5');
    editor.deleteText(range.index - 5, 5);
});
//Header 6
editor.keyboard.addBinding({ key: ' ' }, {
    collapsed: true,
    format: { list: false },  // ...on an line that's not already a list
    prefix: /^######$/,            // ...following a '-' character
    offset: 6,                // ...at the 1st position of the line,
                              // otherwise handler would trigger if the user
                              // typed hyphen+space mid sentence
  }, function(range, context) {
    editor.formatLine(range.index, 1, 'header', '6');
    editor.deleteText(range.index - 6, 6);
});
