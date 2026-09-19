import React from 'react';
import type { NodeViewProps } from '@tiptap/react';
import { MathFormulaView } from './MathFormulaView';
export const InlineMathView = (props: NodeViewProps) => <MathFormulaView {...props} inline />;
