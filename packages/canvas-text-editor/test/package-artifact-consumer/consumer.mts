import {
  CanvasTextEditor,
  CanvasTextView,
  createCanvasRichTextDocument,
  type CanvasTextCollaboration,
} from '@durgakiran/canvas-text-editor';

const publicApi: {
  CanvasTextEditor: typeof CanvasTextEditor;
  CanvasTextView: typeof CanvasTextView;
  createCanvasRichTextDocument: typeof createCanvasRichTextDocument;
  collaboration: CanvasTextCollaboration | null;
} = {
  CanvasTextEditor,
  CanvasTextView,
  createCanvasRichTextDocument,
  collaboration: null,
};

export default publicApi;
