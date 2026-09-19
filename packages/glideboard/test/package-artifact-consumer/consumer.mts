import {
  Glideboard,
  GlideboardController,
  createAssetLibraryProvider,
  type GlideboardHandle,
} from '@durgakiran/glideboard';

const publicApi: {
  Glideboard: typeof Glideboard;
  GlideboardController: typeof GlideboardController;
  createAssetLibraryProvider: typeof createAssetLibraryProvider;
  handle: GlideboardHandle | null;
} = {
  Glideboard,
  GlideboardController,
  createAssetLibraryProvider,
  handle: null,
};

export default publicApi;
