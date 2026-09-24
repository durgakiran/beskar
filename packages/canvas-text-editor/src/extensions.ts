import type { Extensions } from '@tiptap/core';
import { Bold } from '@tiptap/extension-bold';
import { Code } from '@tiptap/extension-code';
import { Collaboration } from '@tiptap/extension-collaboration';
import { CollaborationCaret } from '@tiptap/extension-collaboration-caret';
import { Document } from '@tiptap/extension-document';
import { HardBreak } from '@tiptap/extension-hard-break';
import { Highlight } from '@tiptap/extension-highlight';
import { Italic } from '@tiptap/extension-italic';
import { Link } from '@tiptap/extension-link';
import { BulletList, ListItem, ListKeymap, OrderedList } from '@tiptap/extension-list';
import { Paragraph } from '@tiptap/extension-paragraph';
import { Text } from '@tiptap/extension-text';
import { UndoRedo } from '@tiptap/extensions';
import type { XmlFragment } from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import { normalizeExternalUrl } from './model.js';

export interface CanvasTextCollaborator {
  id: string;
  name: string;
  color: string;
}

export type CanvasTextAwareness = Pick<Awareness, 'getStates' | 'setLocalStateField' | 'on' | 'off'>;

/** Structural boundary avoids nominal Yjs type conflicts across package installers. */
export interface CanvasTextFragment {
  readonly length: number;
  observeDeep?(listener: (events: readonly unknown[], transaction: unknown) => void): void;
  unobserveDeep?(listener: (events: readonly unknown[], transaction: unknown) => void): void;
}

export interface CanvasTextCollaboration {
  fragment: CanvasTextFragment;
  awareness?: CanvasTextAwareness;
  user?: CanvasTextCollaborator;
}

export function createCanvasTextExtensions(collaboration?: CanvasTextCollaboration): Extensions {
  const extensions: Extensions = [
    Document,
    Paragraph,
    Text,
    Bold,
    Italic,
    Code,
    HardBreak,
    BulletList,
    OrderedList,
    ListItem,
    ListKeymap,
    Link.configure({
      autolink: true,
      openOnClick: false,
      defaultProtocol: 'https',
      isAllowedUri: value => normalizeExternalUrl(value) !== null,
      HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
    }),
    Highlight.configure({ multicolor: true }),
  ];

  if (!collaboration) extensions.push(UndoRedo);

  if (collaboration) {
    extensions.push(Collaboration.configure({ fragment: collaboration.fragment as XmlFragment }));
    if (collaboration.awareness && collaboration.user) {
      extensions.push(CollaborationCaret.configure({
        provider: { awareness: collaboration.awareness },
        user: collaboration.user,
      }));
    }
  }
  return extensions;
}
