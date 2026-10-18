import React from 'react';
import type { NodeViewProps } from '@tiptap/react';
import { InternalResourceView } from './InternalResourceView';

export function InternalDocInlineView(props: NodeViewProps) {
  return <InternalResourceView {...props} inline />;
}
