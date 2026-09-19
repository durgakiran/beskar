import {
  GlideEditor,
  createEditor,
  sid,
  type GlideDocument,
  type PortableBoardFragment,
} from '@durgakiran/glideline';

const publicApi: {
  GlideEditor: typeof GlideEditor;
  createEditor: typeof createEditor;
  sid: typeof sid;
  document: GlideDocument | null;
  fragment: PortableBoardFragment | null;
} = {
  GlideEditor,
  createEditor,
  sid,
  document: null,
  fragment: null,
};

export default publicApi;
