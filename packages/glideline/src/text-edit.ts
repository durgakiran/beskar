import { signal, type Signal } from '@preact/signals';
import type { ShapeId } from './types.js';

export type EditableTextField = 'text' | 'label' | 'richText';

export interface EditableTextValue {
  readonly field: EditableTextField;
  readonly value: string;
}

export interface TextEditSession {
  readonly shapeId: ShapeId;
  readonly field: EditableTextField;
  readonly baseRevision: number;
  readonly baseValue: string;
  readonly draft: string;
  readonly dirty: boolean;
  readonly composing: boolean;
  /** Shape-owned props previewed during editing and committed with the text. */
  readonly pendingProps?: Readonly<Record<string, unknown>>;
  readonly status: 'editing' | 'conflicted' | 'committing' | 'closed';
}

export interface RecoverableTextEditDraft {
  readonly shapeId: ShapeId;
  readonly field: EditableTextField;
  readonly text: string;
}

interface TextEditHost {
  getRevision(): number;
  getEditableText(shapeId: ShapeId): EditableTextValue | null;
  commit(
    shapeId: ShapeId,
    draft: string,
    pendingProps?: Readonly<Record<string, unknown>>,
  ): void;
}

export class TextEditSessionController {
  readonly session: Signal<TextEditSession | null> = signal(null);
  readonly recoverableDraft: Signal<RecoverableTextEditDraft | null> = signal(null);

  constructor(private readonly host: TextEditHost) {}

  start(
    shapeId: ShapeId,
    pendingProps?: Readonly<Record<string, unknown>>,
  ): TextEditSession | null {
    const current = this.session.peek();
    if (current?.shapeId === shapeId) return current;
    if (current?.dirty) {
      this.recoverableDraft.value = Object.freeze({
        shapeId: current.shapeId,
        field: current.field,
        text: current.draft,
      });
    }
    const editable = this.host.getEditableText(shapeId);
    if (!editable) return null;
    const next = Object.freeze({
      shapeId,
      field: editable.field,
      baseRevision: this.host.getRevision(),
      baseValue: editable.value,
      draft: editable.value,
      dirty: false,
      composing: false,
      ...(pendingProps ? { pendingProps: Object.freeze({ ...pendingProps }) } : {}),
      status: 'editing' as const,
    });
    this.session.value = next;
    return next;
  }

  updateDraft(
    draft: string,
    pendingProps?: Readonly<Record<string, unknown>>,
    forceDirty = false,
  ): void {
    const current = this.session.peek();
    if (!current || current.status === 'committing' || current.status === 'closed') return;
    const nextPendingProps = pendingProps ? Object.freeze({ ...pendingProps }) : current.pendingProps;
    if (
      !forceDirty
      && draft === current.draft
      && JSON.stringify(nextPendingProps) === JSON.stringify(current.pendingProps)
      && current.status !== 'conflicted'
    ) return;
    this.session.value = Object.freeze({
      ...current,
      draft,
      dirty: current.dirty || forceDirty || draft !== current.baseValue,
      ...(nextPendingProps ? { pendingProps: nextPendingProps } : {}),
      status: current.status === 'conflicted' ? 'conflicted' : 'editing',
    });
  }

  setComposing(composing: boolean): void {
    const current = this.session.peek();
    if (current) this.session.value = Object.freeze({ ...current, composing });
  }

  reconcile(): void {
    const current = this.session.peek();
    if (!current || current.status === 'committing' || current.status === 'closed') return;
    const latest = this.host.getEditableText(current.shapeId);
    if (!latest || latest.field !== current.field) {
      if (current.dirty) {
        this.recoverableDraft.value = Object.freeze({
          shapeId: current.shapeId,
          field: current.field,
          text: current.draft,
        });
      }
      this.session.value = null;
      return;
    }
    if (latest.value === current.baseValue) {
      if (current.status === 'conflicted') {
        this.session.value = Object.freeze({ ...current, status: 'editing' });
      }
      return;
    }
    if (current.dirty && latest.value !== current.draft) {
      this.session.value = Object.freeze({ ...current, status: 'conflicted' });
      return;
    }
    this.session.value = Object.freeze({
      ...current,
      baseRevision: this.host.getRevision(),
      baseValue: latest.value,
      draft: latest.value,
      dirty: false,
      status: 'editing',
    });
  }

  commit(): boolean {
    this.reconcile();
    const current = this.session.peek();
    if (!current || current.composing || current.status === 'conflicted') return false;
    if (!current.dirty) {
      this.session.value = null;
      return true;
    }
    this.session.value = Object.freeze({ ...current, status: 'committing' });
    try {
      this.host.commit(current.shapeId, current.draft, current.pendingProps);
      this.session.value = null;
      return true;
    } catch (error) {
      this.session.value = Object.freeze({ ...current, status: 'editing' });
      throw error;
    }
  }

  cancel(options: { recover?: boolean } = {}): void {
    const current = this.session.peek();
    if (!current) return;
    if (options.recover && current.dirty) {
      this.recoverableDraft.value = Object.freeze({
        shapeId: current.shapeId,
        field: current.field,
        text: current.draft,
      });
    }
    this.session.value = null;
  }
}
