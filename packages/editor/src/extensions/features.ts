/** Optional capabilities. Each entry includes its dependent nodes and plugins. */
export const EDITOR_FEATURE_EXTENSIONS = {
  formatting: ['bold', 'italic', 'strike', 'code', 'underline'],
  heading: ['heading'],
  blockquote: ['blockquote'],
  codeBlock: ['codeBlock', 'codeBlockKeyboard'],
  lists: ['bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem', 'listKeymap'],
  horizontalRule: ['horizontalRule'],
  details: ['details', 'detailsSummary', 'detailsContent'],
  notes: ['noteBlock'],
  images: ['imageBlock', 'imageInline', 'imagePasteDrop'],
  attachments: ['attachmentInline', 'attachmentPasteDrop'],
  status: ['statusBadge'],
  date: ['dateInline'],
  embeds: ['embedInline', 'embedBlock'],
  externalLinks: ['externalLinkInline'],
  internalLinks: ['internalDocInline', 'internalLinkBlock'],
  childPages: ['childPagesList'],
  math: ['mathBlock', 'inlineMath'],
  tableOfContents: ['tableOfContents'],
  textAlign: ['textAlign'],
  color: ['textStyle', 'color'],
  highlight: ['highlight'],
  typography: ['typography'],
  emoji: ['emoji'],
  tables: ['table', 'tableRow', 'tableHeader', 'tableCell'],
  columns: ['columns', 'column'],
  slashCommands: ['slashCommand'],
  comments: ['comment', 'commentDecoration'],
  dragAndDrop: ['blockDragDrop'],
  links: ['link'],
} as const;

export type EditorFeature = keyof typeof EDITOR_FEATURE_EXTENSIONS;

export type EditorFeatureOptions = {
  /** `full` (default) enables unspecified features; `minimal` disables them. */
  preset?: 'full' | 'minimal';
} & Partial<Record<EditorFeature, boolean>>;

export const MANDATORY_EDITOR_EXTENSIONS = [
  'starterKit', 'doc', 'text', 'paragraph', 'customAttributes', 'blockId',
  'editorUi', 'placeholder', 'hardBreak', 'dropCursor', 'gapCursor', 'trailingNode',
] as const;

export function resolveEditorFeatures(options: EditorFeatureOptions = {}): Record<EditorFeature, boolean> {
  const enabled = options.preset !== 'minimal';
  return Object.fromEntries(
    (Object.keys(EDITOR_FEATURE_EXTENSIONS) as EditorFeature[])
      .map((feature) => [feature, options[feature] ?? enabled]),
  ) as Record<EditorFeature, boolean>;
}
