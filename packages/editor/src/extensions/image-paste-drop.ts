/**
 * ImagePasteDrop - Extension for handling image paste and drag-drop upload
 * When attachments are configured, mixed file drops also enqueue non-image files.
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { AttachmentAPIHandler, ImageAPIHandler } from '../types';
import { insertAttachmentsAt } from './attachment-upload';

export interface ImagePasteDropOptions {
  imageHandler?: ImageAPIHandler;
  attachmentHandler?: AttachmentAPIHandler;
  maxAttachmentBytes?: number;
  onAttachmentRejected?: (reason: 'too_large', file: File) => void;
}

export const ImagePasteDrop = Extension.create<ImagePasteDropOptions>({
  name: 'imagePasteDrop',

  addOptions() {
    return {
      imageHandler: undefined,
      attachmentHandler: undefined,
      maxAttachmentBytes: undefined,
      onAttachmentRejected: undefined,
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    const { imageHandler } = options;

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

              const { tr, selection } = view.state;
              const tempImageNode = view.state.schema.nodes.imageBlock.create({
                src: URL.createObjectURL(file),
                alt: file.name,
                uploadStatus: imageHandler ? 'uploading' : 'idle',
              });

              const transaction = tr.replaceSelectionWith(tempImageNode);
              const insertPos = selection.from;
              view.dispatch(transaction);

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

          handleDrop: (view, event) => {
            const hasFiles = event.dataTransfer?.files?.length;
            if (!hasFiles) {
              return false;
            }

            const allFiles = Array.from(event.dataTransfer.files);
            const images = allFiles.filter((file) => file.type.startsWith('image/'));
            const nonImages = allFiles.filter((file) => !file.type.startsWith('image/'));

            if (images.length === 0 && nonImages.length === 0) {
              return false;
            }

            if (images.length === 0 && nonImages.length > 0) {
              return false;
            }

            event.preventDefault();

            const { schema } = view.state;
            const coordinates = view.posAtCoords({
              left: event.clientX,
              top: event.clientY,
            });

            if (!coordinates) return true;

            let dropPos = coordinates.pos;

            for (const file of images) {
              const tempSrc = URL.createObjectURL(file);
              const node = schema.nodes.imageBlock.create({
                src: tempSrc,
                alt: file.name,
                uploadStatus: imageHandler ? 'uploading' : 'idle',
              });

              const insertPos = dropPos;
              const tr = view.state.tr.insert(dropPos, node);
              view.dispatch(tr);
              dropPos += node.nodeSize;

              if (imageHandler) {
                imageHandler
                  .uploadImage(file)
                  .then((result) => {
                    const { state } = view;
                    let foundPos = -1;

                    state.doc.descendants((n, pos) => {
                      if (
                        n.type.name === 'imageBlock' &&
                        n.attrs.uploadStatus === 'uploading' &&
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

                    state.doc.descendants((n, pos) => {
                      if (
                        n.type.name === 'imageBlock' &&
                        n.attrs.uploadStatus === 'uploading' &&
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
            }

            if (nonImages.length > 0 && options.attachmentHandler) {
              insertAttachmentsAt(view, dropPos, nonImages, {
                handler: options.attachmentHandler,
                maxAttachmentBytes: options.maxAttachmentBytes,
                onAttachmentRejected: options.onAttachmentRejected,
              });
            }

            return true;
          },
        },
      }),
    ];
  },
});

export default ImagePasteDrop;
