// import { RefObject, useCallback, useEffect, useRef, useState } from "react";
// import Quill, { QuillOptionsStatic } from 'quill';
export { TipTap } from './tiptap';

// interface QuillObj {
//     editor: Quill | undefined,
//     ref: RefObject<any>
// }

// /**
//  * React hook to render quill editor
//  */
// export function useQuill(options: QuillOptionsStatic): [QuillObj,  (node: any) => void] {
//     const [quillObj, setQuillObj] = useState<QuillObj>({
//         editor: undefined, 
//         ref: undefined
//     });
//     const quillRef: RefObject<any> = useRef();

//     const onRefChange = useCallback((node) => {
//         console.log('ref changed');
//         if (node) {
//             const obj = new Quill(node, options);
//             setQuillObj({ editor: obj, ref: quillRef });
//         }
//     }, []);

//     return [quillObj, onRefChange];
// }

