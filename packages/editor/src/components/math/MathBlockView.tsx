import React from 'react';
import type { NodeViewProps } from '@tiptap/react';
import { MathFormulaView } from './MathFormulaView';
export const MathBlockView = (props: NodeViewProps) => <MathFormulaView {...props} />;
