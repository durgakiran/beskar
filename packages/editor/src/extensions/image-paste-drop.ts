/**
 * ImagePasteDrop - Extension for handling image paste and drag-drop upload
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { ImageAPIHandler } from '../types';

export interface ImagePasteDropOptions {
  imageHandler?: ImageAPIHandler;
}

export const ImagePasteDrop = Extension.create<ImagePasteDropOptions>({
  name: 'imagePasteDrop',

  addOptions() {
    return {
      imageHandler: undefined,
    };
  },

  addProseMirrorPlugins() {
    const { imageHandler } = this.options;

    return [
      new Plugin({
        key: new PluginKey('imagePasteDrop'),
        
        props: {
          handlePaste: (view, event) => {
            const items = Array.from(event.clipboardData?.items || []);
            const imageItems = items.filter((item) => item.type.indexOf('image') === 0);

            if (imageItems.length === 0) {
              return false;
            }

            event.preventDefault();

            imageItems.forEach((item) => {
              const file = item.getAsFile();
              if (!file) return;

              // Insert image block with loading state
              const { tr, selection } = view.state;
              const tempImageNode = view.state.schema.nodes.imageBlock.create({
                src: URL.createObjectURL(file),
                alt: file.name,
                uploadStatus: imageHandler ? 'uploading' : 'idle',
              });

              const transaction = tr.replaceSelectionWith(tempImageNode);
              const insertPos = selection.from;
              view.dispatch(transaction);

              // Upload image if handler is provided
              if (imageHandler) {
                imageHandler
                  .uploadImage(file)
                  .then((result) => {
                    const { state } = view;
                    let foundPos = -1;

                    // Find the uploaded image node
                    state.doc.descendants((node, pos) => {
                      if (
                        node.type.name === 'imageBlock' &&
                        node.attrs.uploadStatus === 'uploading' &&
                        pos >= insertPos - 5 &&
                        pos <= insertPos + 5
                      ) {
                        foundPos = pos;
                        return false;
                      }
                    });

                    if (foundPos >= 0) {
                      const updateTr = state.tr.setNodeMarkup(foundPos, undefined, {
                        src: imageHandler.getImageUrl?.(result.url) || result.url,
                        alt: result.alt || file.name,
                        width: result.width || null,
                        height: result.height || null,
                        caption: '',
                        uploadStatus: 'idle',
                      });
                      view.dispatch(updateTr);
                    }
                  })
                  .catch((error) => {
                    console.error('[ImagePasteDrop] Upload failed:', error);
                    
                    const { state } = view;
                    let foundPos = -1;

                    state.doc.descendants((node, pos) => {
                      if (
                        node.type.name === 'imageBlock' &&
                        node.attrs.uploadStatus === 'uploading' &&
                        pos >= insertPos - 5 &&
                        pos <= insertPos + 5
                      ) {
                        foundPos = pos;
                        return false;
                      }
                    });

                    if (foundPos >= 0) {
                      const updateTr = state.tr.setNodeMarkup(foundPos, undefined, {
                        src: '',
                        alt: file.name,
                        uploadStatus: 'error',
                      });
                      view.dispatch(updateTr);
                    }
                  });
              }
            });

            return true;
          },

          handleDrop: (view, event) => {
            const hasFiles = event.dataTransfer?.files?.length;
            if (!hasFiles) {
              return false;
            }

            const images = Array.from(event.dataTransfer.files).filter((file) =>
              /image/i.test(file.type)
            );

            if (images.length === 0) {
              return false;
            }

            event.preventDefault();

            const { schema } = view.state;
            const coordinates = view.posAtCoords({
              left: event.clientX,
              top: event.clientY,
            });

            if (!coordinates) return true;

            images.forEach((file, index) => {
              const tempSrc = URL.createObjectURL(file);
              const node = schema.nodes.imageBlock.create({
                src: tempSrc,
                alt: file.name,
                uploadStatus: imageHandler ? 'uploading' : 'idle',
              });

              const transaction = view.state.tr.insert(coordinates.pos + index, node);
              const insertPos = coordinates.pos + index;
              view.dispatch(transaction);

              // Upload image if handler is provided
              if (imageHandler) {
                imageHandler
                  .uploadImage(file)
                  .then((result) => {
                    const { state } = view;
                    let foundPos = -1;

                    state.doc.descendants((node, pos) => {
                      if (
                        node.type.name === 'imageBlock' &&
                        node.attrs.uploadStatus === 'uploading' &&
                        pos >= insertPos - 5 &&
                        pos <= insertPos + 5
                      ) {
                        foundPos = pos;
                        return false;
                      }
                    });

                    if (foundPos >= 0) {
                      const updateTr = state.tr.setNodeMarkup(foundPos, undefined, {
                        src: imageHandler.getImageUrl?.(result.url) || result.url,
                        alt: result.alt || file.name,
                        width: result.width || null,
                        height: result.height || null,
                        caption: '',
                        uploadStatus: 'idle',
                      });
                      view.dispatch(updateTr);
                    }
                  })
                  .catch((error) => {
                    console.error('[ImagePasteDrop] Upload failed:', error);

                    const { state } = view;
                    let foundPos = -1;

                    state.doc.descendants((node, pos) => {
                      if (
                        node.type.name === 'imageBlock' &&
                        node.attrs.uploadStatus === 'uploading' &&
                        pos >= insertPos - 5 &&
                        pos <= insertPos + 5
                      ) {
                        foundPos = pos;
                        return false;
                      }
                    });

                    if (foundPos >= 0) {
                      const updateTr = state.tr.setNodeMarkup(foundPos, undefined, {
                        src: '',
                        alt: file.name,
                        uploadStatus: 'error',
                      });
                      view.dispatch(updateTr);
                    }
                  });
              }
            });

            return true;
          },
        },
      }),
    ];
  },
});

export default ImagePasteDrop;

