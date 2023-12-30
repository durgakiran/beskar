import { EditorContent, BubbleMenu,  useEditor } from "@tiptap/react";
import styled from 'styled-components';
import Typography from '@tiptap/extension-typography'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import Document from '@tiptap/extension-document'
import Heading from '@tiptap/extension-heading'
import Placeholder from '@tiptap/extension-placeholder'
import StarterKit from '@tiptap/starter-kit'
import TextStyle from '@tiptap/extension-placeholder'
import Color from '@tiptap/extension-placeholder'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import { WebrtcProvider } from 'y-webrtc'
import * as Y from 'yjs'
import { EXAMPLE_JSON } from "@editor";


const ydoc = new Y.Doc()
const provider = new WebrtcProvider('tiptap-collaboration-cursor-extension', ydoc)




const extensions = [
    StarterKit.configure({
        history: false
    }),
    Typography,
    Paragraph,
    Text,
    Document,
    Heading,
    Placeholder.configure({
        placeholder: 'Write somthing ....'
    }),
    TextStyle, 
    Color,
    Collaboration.configure({
        document: ydoc,
      }),
      CollaborationCursor.configure({
        provider,
        user: {
          name: 'Cyndi Lauper',
          color: '#f783ac',
        },
    }),
    
];

const content = EXAMPLE_JSON;
const StyledEditorContent = styled(EditorContent)`
    height: 100%;
    width: 100%;
    > .tiptap {
        height: 100%;
        margin-top: 0.75em;
        padding: 1rem;
        box-sizing: border-box;
    }
`;

export default function TipTap() {
    const editor = useEditor({
        extensions: extensions,
        content: content
    });

    return (
        <>
        {
            editor &&
            <BubbleMenu editor={editor} tippyOptions={{ duration: 100 }}>
                <button onClick={() => editor.chain().focus().toggleBold().run()} className={editor.isActive('bold') ? 'is-active' : ''}>
                    bold
                </button>
                <button onClick={() => editor.chain().focus().toggleItalic().run()} className={editor.isActive('italic') ? 'is-active' : ''}>
                    italic
                </button>
                <button onClick={() => editor.chain().focus().toggleStrike().run()} className={editor.isActive('strike') ? 'is-active' : ''}>
                    strike
                </button>
            </BubbleMenu>
        }
        <StyledEditorContent className="editor" editor={editor} />
        </>
    )
}




// Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica Neue,Arial,Noto Sans,sans-serif,Apple Color Emoji,Segoe UI Emoji,Segoe UI Symbol,Noto Color Emoji;