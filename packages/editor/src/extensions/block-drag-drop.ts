import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

// BlockDragDrop extension loaded

export interface BlockDragDropOptions {
  types: string[];
}

export interface BlockDragDropState {
  isDragging: boolean;
  draggedNodeType: string | null;
}

export const blockDragDropKey = new PluginKey<BlockDragDropState>("blockDragDrop");

interface BlockInfo {
  node: ProseMirrorNode;
  pos: number;
  dom: HTMLElement;
}

/**
 * Extension that enables drag and drop for block nodes
 * Uses a single drag handle element that repositions itself on hover
 */
export const BlockDragDrop = Extension.create<BlockDragDropOptions>({
  name: "blockDragDrop",

  addOptions() {
    return {
      types: [
        "heading",
        "paragraph",
        "bulletList",
        "orderedList",
        "taskList",
        "blockquote",
        "codeBlock",
        "codeBlockLowlight",
        "table",
        "horizontalRule",
        "details", // Only details should be a block, not detailsSummary/detailsContent
        "noteBlock",
        "imageBlock",
        "mathBlock",
        "tableOfContents",
        "columns",
      ],
    };
  },

  addProseMirrorPlugins() {
    // Shared state accessible to both view() and handleDOMEvents
    let draggedBlockInfo: BlockInfo | null = null;
    let isDragging = false;

    // Drop indicator and hover highlight — created/set inside view() but used by
    // handleDOMEvents props which live in the same Plugin but a different closure.
    let _dropIndicator: HTMLElement | null = null;
    let _indicatorParent: HTMLElement | null = null;
    let _editorContainer: HTMLElement | null = null; // set by view()

    const clearHighlight = () => {
      _editorContainer
        ?.querySelectorAll('.drag-handle-hover')
        .forEach((el) => el.classList.remove('drag-handle-hover'));
    };

    const showDropIndicator = (blockEl: HTMLElement, before: boolean) => {
      if (!_dropIndicator || !_indicatorParent) return;
      const blockRect = blockEl.getBoundingClientRect();
      const parentRect = _indicatorParent.getBoundingClientRect();
      const scrollTop = _indicatorParent.scrollTop;
      const top = before
        ? blockRect.top - parentRect.top + scrollTop - 2
        : blockRect.bottom - parentRect.top + scrollTop - 1;
      _dropIndicator.style.top = `${top}px`;
      _dropIndicator.style.opacity = '1';
    };

    const hideDropIndicator = () => {
      if (_dropIndicator) _dropIndicator.style.opacity = '0';
    };

    return [
      new Plugin({
        key: blockDragDropKey,
        state: {
          init() {
            return { isDragging: false, draggedNodeType: null };
          },
          apply(tr, value) {
            const meta = tr.getMeta(blockDragDropKey);
            if (meta !== undefined) {
              return { 
                isDragging: meta.isDragging,
                draggedNodeType: meta.draggedNodeType || null
              };
            }
            return value;
          },
        },
        view: (editorView) => {
          const container = editorView.dom as HTMLElement;
          _editorContainer = container; // expose to shared outer-scope helpers
          const { isEditable } = this.editor;

          // Don't create drag handle if editor is not editable
          if (!isEditable) {
            return {};
          }

          let dragHandle: HTMLElement | null = null;
          let currentBlockId: string | null = null;
          /** DOM node for the block the handle targets (may lack .block-node). */
          let currentBlockDom: HTMLElement | null = null;
          /** Set after DOM is wired; must match where the handle is appended. */
          let boundEditorChrome: HTMLElement | null = null;

          // Create single drag handle
          const createDragHandle = () => {
            const handle = document.createElement("button");
            handle.className = "block-drag-handle";
            // Remove text content - will use CSS for icon
            handle.draggable = true;
            handle.contentEditable = "false";
            handle.type = "button";
            handle.setAttribute("aria-label", "Drag to reorder block");
            handle.style.position = "absolute";
            handle.style.opacity = "0";
            handle.style.transition = "opacity 0.15s ease";
            handle.style.pointerEvents = "auto";
            handle.style.cursor = "grab";
            handle.style.zIndex = "10";

            // Append to container's parent to avoid ProseMirror treating it as content
            const parent = container.parentElement;
            parent?.appendChild(handle);

            // Drag events - attach AFTER appending to DOM
            handle.addEventListener("dragstart", handleDragStart, false);
            handle.addEventListener("dragend", handleDragEnd, false);

            return handle;
          };

          const findBlockAtPos = (pos: number): BlockInfo | null => {
            try {
              const $pos = editorView.state.doc.resolve(pos);

              // Walk up the tree to find a block node
              for (let depth = $pos.depth; depth > 0; depth--) {
                const node = $pos.node(depth);
                if (
                  this.options.types.includes(node.type.name) &&
                  node.attrs.blockId
                ) {
                  const nodePos = $pos.before(depth);
                  const dom = editorView.nodeDOM(nodePos) as HTMLElement;
                  if (dom && dom.classList.contains("block-node")) {
                    return { node, pos: nodePos, dom };
                  }
                }
              }
            } catch (e) {
              console.error('[findBlockAtPos] Error:', e);
            }
            return null;
          };

          const findBlockFromElement = (
            element: HTMLElement
          ): BlockInfo | null => {
            try {
              // Special handling for tableWrapper and code-block-wrapper - find by blockId
              let targetElement = element;
              if (element.classList.contains('tableWrapper')) {
                const table = element.querySelector('table');
                if (table) {
                  targetElement = table as HTMLElement;
                }
              } else if (element.classList.contains('code-block-wrapper')) {
                // For code blocks, use the wrapper itself
                targetElement = element;
              }
              
              // Special handling for React-rendered blocks (like imageBlock)
              // If we're inside a .react-renderer, use that as the target
              if (!element.classList.contains('react-renderer')) {
                const reactRenderer = element.closest('.react-renderer') as HTMLElement;
                if (reactRenderer && reactRenderer.classList.contains('block-node')) {
                  targetElement = reactRenderer;
                }
              }

              // For atom nodes (like imageBlock), posAtDOM returns position BEFORE the node (depth 0)
              // So we need to find the node by blockId instead.
              // Only match top-level blocks (parent === doc) — this prevents inner blocks
              // (e.g. paragraphs inside a columns layout) from getting handles instead of
              // their top-level container.
              const blockId = targetElement.getAttribute('data-block-id');
              if (blockId) {
                let foundBlock: BlockInfo | null = null;
                const doc = editorView.state.doc;

                doc.descendants((node, pos, parent) => {
                  if (
                    parent === doc &&
                    this.options.types.includes(node.type.name) &&
                    node.attrs.blockId === blockId
                  ) {
                    const dom = editorView.nodeDOM(pos) as HTMLElement;
                    if (dom) {
                      foundBlock = { node, pos, dom };
                      return false; // Stop searching
                    }
                  }
                });

                if (foundBlock) {
                  return foundBlock;
                }
              }
              
              // Fallback: Try the old method (works for non-atom nodes like tables, paragraphs)
              let pos = editorView.posAtDOM(targetElement, 0);
              const $pos = editorView.state.doc.resolve(pos);
              
              // Walk UP the document tree to find the top-level block (depth 1)
              for (let depth = $pos.depth; depth > 0; depth--) {
                const node = $pos.node(depth);

                // Only consider nodes at depth 1 (direct children of document)
                if (
                  depth === 1 &&
                  this.options.types.includes(node.type.name) &&
                  node.attrs.blockId
                ) {
                  const nodePos = $pos.before(depth);
                  const dom = editorView.nodeDOM(nodePos) as HTMLElement;
                  if (dom) {
                    return { node, pos: nodePos, dom };
                  }
                }
              }
            } catch (e) {
              console.error('[findBlockFromElement] Error:', e);
            }
            return null;
          };

          /** Resolve the outer DOM for a top-level block id (same rules as findBlockFromElement). */
          const findDomForTopLevelBlockId = (blockId: string): HTMLElement | null => {
            const doc = editorView.state.doc;
            let out: HTMLElement | null = null;
            doc.descendants((node, pos, parent) => {
              if (
                parent === doc &&
                this.options.types.includes(node.type.name) &&
                node.attrs.blockId === blockId
              ) {
                const dom = editorView.nodeDOM(pos) as HTMLElement | null;
                if (dom) {
                  out = dom;
                  return false;
                }
              }
            });
            return out;
          };

          const positionHandle = (blockInfo: BlockInfo) => {
            if (!dragHandle) return;

            const nodeType = blockInfo.node.type.name;

            // Use the DOM element returned by nodeDOM (may be a wrapper div for some block types)
            let blockElement = blockInfo.dom;

            // Resolve to the most useful inner element for precise rect measurement
            if (blockElement.classList.contains('react-renderer')) {
              if (nodeType === 'imageBlock') {
                const el = blockElement.querySelector('.image-block-container') as HTMLElement;
                if (el) blockElement = el;
              } else if (nodeType === 'attachmentBlock') {
                const el = blockElement.querySelector('.attachment-block-card') as HTMLElement;
                if (el) blockElement = el;
              } else if (nodeType === 'noteBlock') {
                // NoteBlockView renders: react-renderer > NodeViewWrapper(.note-block-wrapper) >
                //   .note-block-content-wrapper > .note-block-content (NodeViewContent)
                // .note-block-content rect starts right where the text starts.
                const el = blockElement.querySelector('.note-block-content') as HTMLElement;
                if (el) blockElement = el;
              } else if (nodeType === 'mathBlock') {
                const el = blockElement.querySelector('.math-block, [data-type="math-block"], .katex-display, .katex') as HTMLElement;
                if (el) blockElement = el;
              }
              // 'columns' — use the wrapper as-is; no useful inner text anchor
            }

            // Table: nodeDOM returns a .tableWrapper div — drill into the actual <table>
            // so blockRect reflects the table rows, not the outer div's padding.
            if (nodeType === 'table') {
              const tableEl = blockElement.querySelector('table') as HTMLElement;
              if (tableEl) blockElement = tableEl;
            }

            // Details: nodeDOM returns a plain div wrapper — drill into <details>
            if (nodeType === 'details') {
              const detailsEl = blockElement.querySelector('details') as HTMLElement
                ?? (blockElement.tagName.toLowerCase() === 'details' ? blockElement : null);
              if (detailsEl) blockElement = detailsEl;
            }
            
            // blockRect drives the TOP calculation (from the resolved inner element).
            // outerRect drives the LEFT calculation — always the outer block so the
            // handle stays in the gutter regardless of which inner element we resolved.
            const blockRect = blockElement.getBoundingClientRect();
            const outerRect = blockInfo.dom.getBoundingClientRect();

            const parent = container.parentElement;
            if (!parent) return;

            const parentRect = parent.getBoundingClientRect();

            // Centre the handle on the first line of the block's text content.
            const isTable = nodeType === 'table';
            const isImage = nodeType === 'imageBlock';
            const isMath  = nodeType === 'mathBlock';

            const handleHeight = 20; // matches CSS height: 1.25rem
            let topOffset: number;
            let debugFirstLineEl: HTMLElement = blockElement;
            let debugFirstLineHeight = 0;

            const isColumns = nodeType === 'columns';

            if (isTable || isImage || isMath || isColumns) {
              // Container/non-text blocks: pin handle near the top of the block
              topOffset = 8;
            } else if (nodeType === 'noteBlock') {
              // blockElement is .note-block-content (flex child after the icon).
              // Its top rect IS the text top — just centre the handle on that line height.
              const computed = window.getComputedStyle(blockElement);
              const rawLH = computed.lineHeight;
              const lh = rawLH === 'normal' ? parseFloat(computed.fontSize) * 1.2 : parseFloat(rawLH);
              debugFirstLineEl = blockElement;
              debugFirstLineHeight = lh;
              topOffset = Math.max(0, (lh - handleHeight) / 2);
            } else if (nodeType === 'details') {
              // TipTap Details uses a NodeView <div> wrapper; the summary (title) is at
              // the top. Try to find a <summary> element or the first text-bearing child.
              const summaryEl =
                blockElement.querySelector<HTMLElement>('summary') ??
                blockElement.querySelector<HTMLElement>('[data-type="detailsSummary"]') ??
                blockElement;
              const summaryComputed = window.getComputedStyle(summaryEl);
              const rawLH = summaryComputed.lineHeight;
              const lh = rawLH === 'normal' ? parseFloat(summaryComputed.fontSize) * 1.2 : parseFloat(rawLH);
              debugFirstLineEl = summaryEl;
              debugFirstLineHeight = lh;
              if (summaryEl !== blockElement) {
                const summaryRect = summaryEl.getBoundingClientRect();
                const centerInBlock = (summaryRect.top - blockRect.top) + lh / 2;
                topOffset = Math.max(0, centerInBlock - handleHeight / 2);
              } else {
                topOffset = Math.max(0, (lh - handleHeight) / 2);
              }
            } else {
              // For composite blocks (lists, blockquotes) the block element's own
              // computed line-height is the *inherited* value and doesn't reflect
              // the first visible text line. Instead, measure the actual bounding
              // rect of the first inline text container so we get the true position.
              const firstLineEl: HTMLElement =
                blockElement.querySelector<HTMLElement>('li > p, li > div, li') ??
                blockElement;

              const firstLineComputed = window.getComputedStyle(firstLineEl);
              const rawLineHeight = firstLineComputed.lineHeight;
              const firstLineHeight =
                rawLineHeight === 'normal'
                  ? parseFloat(firstLineComputed.fontSize) * 1.2
                  : parseFloat(rawLineHeight);

              debugFirstLineEl = firstLineEl;
              debugFirstLineHeight = firstLineHeight;

              if (firstLineEl !== blockElement) {
                // Measure real distance from block top to the first line's centre
                const firstLineRect = firstLineEl.getBoundingClientRect();
                const firstLineCenterInBlock =
                  (firstLineRect.top - blockRect.top) + firstLineHeight / 2;
                topOffset = Math.max(0, firstLineCenterInBlock - handleHeight / 2);
              } else {
                // blockElement IS the text node (heading, paragraph, etc.)
                topOffset = Math.max(0, (firstLineHeight - handleHeight) / 2);
              }
            }

            // TOP: relative to the resolved inner element (precise text centering).
            // LEFT: relative to the outer block (keeps handle in the gutter for all block types,
            //       including noteBlock where the resolved element is offset right by the icon).
            const top = blockRect.top - parentRect.top + parent.scrollTop + topOffset;
            const left = outerRect.left - parentRect.left + parent.scrollLeft - 44;

            dragHandle.style.top = `${top}px`;
            dragHandle.style.left = `${left}px`;
          };

          const showHandle = (blockInfo: BlockInfo) => {
            if (!dragHandle || isDragging) return;

            const newBlockId = blockInfo.node.attrs.blockId;
            if (currentBlockId !== newBlockId) {
              clearHighlight();
              currentBlockId = newBlockId;
            }
            // Always ensure the hover highlight is on the current block element.
            // (clearHighlight may have stripped it when the mouse briefly left.)
            currentBlockDom = blockInfo.dom;
            blockInfo.dom.classList.add('drag-handle-hover');
            positionHandle(blockInfo);
            dragHandle.style.opacity = "1";
          };

          const hideHandle = () => {
            if (!dragHandle || isDragging) return;

            dragHandle.style.opacity = "0";
            clearHighlight();
            // Don't clear currentBlockId immediately — keep it so a fast grab still works.
          };

          /** Re-apply highlight when the pointer is on the handle (or after stale DOM). */
          const restoreBlockHighlightForActiveBlock = () => {
            if (isDragging || !currentBlockId || !dragHandle) return;
            if (!currentBlockDom || !container.contains(currentBlockDom)) {
              currentBlockDom = findDomForTopLevelBlockId(currentBlockId);
            }
            if (currentBlockDom) {
              currentBlockDom.classList.add('drag-handle-hover');
              dragHandle.style.opacity = '1';
            }
          };

          const handleMouseMove = (event: MouseEvent) => {
            if (isDragging) return;

            // Use elementFromPoint to get the actual element under the mouse cursor
            let elementUnderMouse = document.elementFromPoint(
              event.clientX,
              event.clientY
            ) as HTMLElement;
            if (!elementUnderMouse) return;

            // Skip table grip handles - they interfere with drag handle detection
            if (elementUnderMouse.classList.contains('grip-column') || 
                elementUnderMouse.classList.contains('grip-row')) {
              // Check if we should show handle for the table wrapper instead
              const tableWrapper = elementUnderMouse.closest('.tableWrapper') as HTMLElement;
              if (tableWrapper) {
                const blockInfo = findBlockFromElement(tableWrapper);
                if (blockInfo && blockInfo.node.attrs.blockId !== currentBlockId) {
                  showHandle(blockInfo);
                }
              }
              return;
            }
            
            // Check if we're inside a React-rendered block (like imageBlock)
            // and show handle for the react-renderer container
            if (!elementUnderMouse.classList.contains('block-node')) {
              const reactRenderer = elementUnderMouse.closest('.react-renderer.block-node') as HTMLElement;
              if (reactRenderer) {
                const blockInfo = findBlockFromElement(reactRenderer);
                if (blockInfo && blockInfo.node.attrs.blockId !== currentBlockId) {
                  showHandle(blockInfo);
                  return;
                }
              }
            }

            // Check if hovering directly over the handle or near it
            // This check should work regardless of currentBlockId state
            if (dragHandle) {
              // Direct hover check - if mouse is on the handle itself
              if (
                elementUnderMouse === dragHandle ||
                dragHandle.contains(elementUnderMouse)
              ) {
                restoreBlockHighlightForActiveBlock();
                return;
              }

              // Buffer zone check - if mouse is near the handle
              const handleRect = dragHandle.getBoundingClientRect();
              const mouseX = event.clientX;
              const mouseY = event.clientY;

              const buffer = 50;
              const inHandleZone =
                mouseX >= handleRect.left - buffer &&
                mouseX <= handleRect.right + buffer &&
                mouseY >= handleRect.top - buffer &&
                mouseY <= handleRect.bottom + buffer;

              if (inHandleZone) {
                restoreBlockHighlightForActiveBlock();
                return;
              }
            }

            // Find block under mouse
            const blockInfo = findBlockFromElement(elementUnderMouse);

            if (blockInfo && blockInfo.node.attrs.blockId !== currentBlockId) {
              showHandle(blockInfo);
            } else if (!blockInfo && currentBlockId) {
              // Only hide if we have a currentBlockId and found no block
              hideHandle();
            }
          };

          const handleDragStart = (event: DragEvent) => {
            if (!currentBlockId) {
              return;
            }

            // Find the block we're dragging
            const blocks = container.querySelectorAll(".block-node");
            let blockElement: HTMLElement | null = null;

            for (const block of Array.from(blocks)) {
              if (
                (block as HTMLElement).getAttribute("data-block-id") ===
                currentBlockId
              ) {
                blockElement = block as HTMLElement;
                break;
              }
            }

            if (!blockElement) {
              return;
            }

            draggedBlockInfo = findBlockFromElement(blockElement);
            if (!draggedBlockInfo) {
              return;
            }

            isDragging = true;
            
            // Stop ProseMirror's DOM observer before making DOM changes to prevent
            // readDOMChange from corrupting the document state during the drag.
            const domObserver = (editorView as any).domObserver;
            if (domObserver) domObserver.stop();
            
            blockElement.classList.add("dragging");
            
            // Set drag state in plugin state to prevent table normalization
            // Use a non-document-changing transaction
            const tr = editorView.state.tr;
            tr.setMeta('addToHistory', false);
            tr.setMeta(blockDragDropKey, { 
              isDragging: true, 
              draggedNodeType: draggedBlockInfo.node.type.name 
            });
            tr.setMeta('skipFixTables', true);
            editorView.dispatch(tr);

            if (dragHandle) {
              dragHandle.style.cursor = "grabbing";
            }

            // Set drag data
            if (event.dataTransfer) {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/html", ""); // Required for Firefox

              // Create custom drag image.
              // The clone must live inside a .beskar-editor > .ProseMirror wrapper so
              // that all CSS selectors (e.g. .beskar-editor .ProseMirror .block-node)
              // apply to it and the ghost shows real content, not an empty box.
              try {
                // Resolve background colour from the editor's ancestor chain.
                let bgColor = '';
                let bgEl: HTMLElement | null = container;
                while (bgEl) {
                  const bg = window.getComputedStyle(bgEl).backgroundColor;
                  if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
                    bgColor = bg;
                    break;
                  }
                  bgEl = bgEl.parentElement;
                }

                // Mirror dark-mode class so dark-theme styles apply to the ghost.
                const editorEl = container.closest('.beskar-editor') as HTMLElement | null;
                const isDark = editorEl?.classList.contains('dark') ?? false;

                // Outer wrapper replicates the CSS selector scope.
                const ghostHost = document.createElement('div');
                ghostHost.className = `beskar-editor${isDark ? ' dark' : ''}`;
                ghostHost.style.cssText =
                  'position:fixed;top:-9999px;left:-9999px;pointer-events:none;z-index:-1;';

                // CSS custom properties (--editor-*) are not inherited when the ghost
                // is outside the real editor DOM tree. Copy them explicitly so text
                // colour, font, and accent colours render correctly in the ghost.
                if (editorEl) {
                  const editorComputed = window.getComputedStyle(editorEl);
                  const cssVarDecls: string[] = [];
                  for (const prop of Array.from(editorComputed)) {
                    if (prop.startsWith('--')) {
                      cssVarDecls.push(`${prop}:${editorComputed.getPropertyValue(prop)}`);
                    }
                  }
                  if (cssVarDecls.length) {
                    ghostHost.style.cssText += ';' + cssVarDecls.join(';');
                  }
                  // Also forward explicit text / font properties so computed values apply.
                  ghostHost.style.color = editorComputed.color;
                  ghostHost.style.fontFamily = editorComputed.fontFamily;
                  ghostHost.style.fontSize = editorComputed.fontSize;
                  ghostHost.style.lineHeight = editorComputed.lineHeight;
                }

                const pmHost = document.createElement('div');
                pmHost.className = 'ProseMirror';
                pmHost.style.width = `${blockElement.offsetWidth}px`;

                const clone = blockElement.cloneNode(true) as HTMLElement;
                // Remove state classes that shouldn't appear on the ghost.
                clone.classList.remove('dragging', 'drag-over', 'drag-over-top', 'drag-over-bottom');
                clone.style.backgroundColor = bgColor || '#ffffff';
                clone.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.18)';
                clone.style.borderRadius = '0.375rem';
                clone.style.opacity = '0.95';
                clone.style.overflow = 'hidden';
                // Cap height for large blocks (tables, etc.) so ghost isn't enormous.
                clone.style.maxHeight = '320px';

                // Strip interactive decorations that look wrong on the ghost.
                clone.querySelectorAll('.grip-column, .grip-row').forEach(el => el.remove());
                clone.querySelectorAll('.note-block-toolbar-floating, .image-block-toolbar-floating').forEach(el => el.remove());

                pmHost.appendChild(clone);
                ghostHost.appendChild(pmHost);
                document.body.appendChild(ghostHost);

                // Offset cursor slightly into the card so the ghost is visible.
                event.dataTransfer.setDragImage(clone, 24, 16);
                setTimeout(() => ghostHost.remove(), 0);
              } catch (e) {
                console.error('[handleDragStart] Error in createDragImage:', e);
              }
            }
          };

          const handleDragEnd = () => {
            // Delay ALL cleanup to allow drop handler and all transactions to complete first
            // This prevents fixTables from running on intermediate corrupted state
            setTimeout(() => {
              try {
                isDragging = false;
                
                // Clear drag state in plugin state
                // Use a non-document-changing transaction
                const tr = editorView.state.tr;
                tr.setMeta('addToHistory', false);
                tr.setMeta(blockDragDropKey, { isDragging: false, draggedNodeType: null });
                tr.setMeta('skipFixTables', true); // Mark this transaction to skip fixTables
                editorView.dispatch(tr);

                if (dragHandle) {
                  dragHandle.style.cursor = "grab";
                }

                // Clean up dragging classes, hover highlight and drop indicator
                hideDropIndicator();
                clearHighlight();
                container
                  .querySelectorAll(".dragging")
                  .forEach((el) => el.classList.remove("dragging"));

                draggedBlockInfo = null;
                currentBlockId = null;
                currentBlockDom = null;
                
                // Restart ProseMirror's DOM observer (stopped in handleDragStart).
                const domObserver = (editorView as any).domObserver;
                if (domObserver) {
                  domObserver.start();
                  domObserver.flush();
                }
              } catch (error) {
                console.error('[DRAG END] Error in cleanup:', error);
              }
            }, 150);
          };

          const handleScroll = () => {
            if (currentBlockId && !isDragging) {
              const blockElement = container.querySelector(
                `.block-node[data-block-id="${currentBlockId}"]`
              ) as HTMLElement;

              if (blockElement) {
                const blockInfo = findBlockFromElement(blockElement);
                if (blockInfo) {
                  positionHandle(blockInfo);
                }
              }
            }
          };

          const handleMouseLeave = () => {
            hideHandle();
          };

          // Initialize
          // Wait for the container to be in the DOM before creating the handle
          const initHandle = () => {
            if (document.contains(container)) {
              if (!dragHandle) {
                dragHandle = createDragHandle();
                // Click / focus can occur without a mousemove over the handle (e.g. tap,
                // or pointer path quirks). Ensure the active block is highlighted.
                dragHandle.addEventListener('pointerenter', restoreBlockHighlightForActiveBlock);
                dragHandle.addEventListener('pointerdown', restoreBlockHighlightForActiveBlock, true);
                dragHandle.addEventListener('focus', restoreBlockHighlightForActiveBlock);
              }

              // Listen on the same parent that holds the handle (see createDragHandle).
              // Defer until we're in the document so parentElement is non-null and stable.
              if (!boundEditorChrome) {
                boundEditorChrome = container.parentElement ?? container;
                boundEditorChrome.addEventListener(
                  'mousemove',
                  handleMouseMove,
                  true
                );
                boundEditorChrome.addEventListener('mouseleave', handleMouseLeave);
              }

              // Dedicated drop indicator — a single <div> we reposition during dragover.
              // Using a managed element instead of ::before/::after pseudo-elements avoids
              // the requirement for position:relative on every block type.
              const parent = container.parentElement;
              if (parent) {
                _indicatorParent = parent;
                _dropIndicator = document.createElement('div');
                _dropIndicator.className = 'block-drag-drop-indicator';
                _dropIndicator.style.cssText = [
                  'position:absolute',
                  'left:0',
                  'right:0',
                  'height:3px',
                  'border-radius:2px',
                  'pointer-events:none',
                  'opacity:0',
                  'transition:top 0.05s ease',
                  'z-index:20',
                ].join(';');
                parent.appendChild(_dropIndicator);
              }
            } else {
              setTimeout(initHandle, 10);
            }
          };

          initHandle();

          container.classList.add("has-block-drag-handles");

          container.addEventListener("scroll", handleScroll);
          window.addEventListener("resize", handleScroll);

          return {
            update: () => {
              // Reposition handle if needed
              if (currentBlockId && !isDragging && dragHandle) {
                const blockElement = container.querySelector(
                  `.block-node[data-block-id="${currentBlockId}"]`
                ) as HTMLElement;

                if (blockElement) {
                  const blockInfo = findBlockFromElement(blockElement);
                  if (blockInfo) {
                    positionHandle(blockInfo);
                  }
                } else {
                  hideHandle();
                }
              }
            },

            destroy() {
              if (boundEditorChrome) {
                boundEditorChrome.removeEventListener("mousemove", handleMouseMove, true);
                boundEditorChrome.removeEventListener("mouseleave", handleMouseLeave);
                boundEditorChrome = null;
              }
              container.removeEventListener("scroll", handleScroll);
              window.removeEventListener("resize", handleScroll);

              if (dragHandle) {
                dragHandle.removeEventListener("pointerenter", restoreBlockHighlightForActiveBlock);
                dragHandle.removeEventListener("pointerdown", restoreBlockHighlightForActiveBlock, true);
                dragHandle.removeEventListener("focus", restoreBlockHighlightForActiveBlock);
                dragHandle.removeEventListener("dragstart", handleDragStart);
                dragHandle.removeEventListener("dragend", handleDragEnd);
                dragHandle.remove();
                dragHandle = null;
              }

              if (_dropIndicator) {
                _dropIndicator.remove();
                _dropIndicator = null;
                _indicatorParent = null;
              }

              container.classList.remove("has-block-drag-handles");
            },
          };
        },

        props: {
          handleDOMEvents: {
            dragover: (view, event) => {
              if (!isDragging) return false;

              event.preventDefault();
              if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';

              // Helper: show indicator for a resolved dom element + half
              const applyIndicator = (dom: HTMLElement, before: boolean) => {
                if (dom.classList.contains('dragging')) return;
                showDropIndicator(dom, before);
              };

              // Find target block via posAtCoords (works in the content area).
              const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });

              if (!pos) {
                // Cursor is in the left gutter (over the drag handle) — posAtCoords
                // returns null there. Use Y-proximity over top-level blocks only.
                const doc = view.state.doc;
                let bestDom: HTMLElement | null = null;
                let bestDist = Infinity;

                for (const el of Array.from(
                  view.dom.querySelectorAll<HTMLElement>('.block-node:not(.dragging)')
                )) {
                  // Skip blocks that are nested inside another block-node (e.g. paragraphs
                  // inside a columns layout) — only consider top-level blocks.
                  if (el.parentElement?.closest('.block-node')) continue;
                  // Verify it's actually a top-level node in the doc.
                  const blockId = el.getAttribute('data-block-id');
                  if (!blockId) continue;
                  let isTopLevel = false;
                  doc.descendants((node, _pos, parent) => {
                    if (node.attrs.blockId === blockId && parent === doc) {
                      isTopLevel = true;
                      return false;
                    }
                  });
                  if (!isTopLevel) continue;

                  const r = el.getBoundingClientRect();
                  const dist = Math.abs(event.clientY - (r.top + r.height / 2));
                  if (dist < bestDist) { bestDist = dist; bestDom = el; }
                }

                if (bestDom !== null) {
                  const rect = (bestDom as HTMLElement).getBoundingClientRect();
                  applyIndicator(bestDom as HTMLElement, event.clientY < rect.top + rect.height / 2);
                }
                return true;
              }

              const $pos = view.state.doc.resolve(pos.pos);

              // Walk up to the depth-1 block (top-level, never inner content).
              for (let depth = $pos.depth; depth > 0; depth--) {
                const node = $pos.node(depth);
                if (
                  depth === 1 &&
                  this.options.types.includes(node.type.name) &&
                  node.attrs.blockId
                ) {
                  const nodePos = $pos.before(depth);
                  const dom = view.nodeDOM(nodePos) as HTMLElement;
                  if (dom && !dom.classList.contains('dragging')) {
                    const rect = dom.getBoundingClientRect();
                    applyIndicator(dom, event.clientY < rect.top + rect.height / 2);
                  }
                  break;
                }
              }

              return true;
            },

            drop: (view, event) => {
              if (!isDragging || !draggedBlockInfo) {
                return false;
              }

              event.preventDefault();

              try {
                // Get dragged block info from stored data
                const draggedPos = draggedBlockInfo.pos;
                
                // IMPORTANT: Use the CACHED node from draggedBlockInfo, not the current state
                // The current state may have been corrupted during the drag operation
                const draggedNode = draggedBlockInfo.node;

                if (!draggedNode) {
                  return false;
                }

                // Find drop target by checking which block is under the mouse
                let targetPos: number | null = null;
                let dropBefore: boolean | undefined = undefined;
                
                // Find the block element under the mouse cursor
                const elementUnderMouse = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement;
                
                if (!elementUnderMouse) {
                  return false;
                }
                
                // Walk up the DOM to find a block node
                let blockElement = elementUnderMouse.closest('.block-node') as HTMLElement;
                
                // If no block found directly, find the nearest block by Y position
                if (!blockElement) {
                  const allBlocks = Array.from(view.dom.querySelectorAll('.block-node')) as HTMLElement[];
                  
                  let closestBlock: HTMLElement | null = null;
                  let closestDistance = Infinity;
                  
                  for (const block of allBlocks) {
                    const rect = block.getBoundingClientRect();
                    const blockCenterY = rect.top + rect.height / 2;
                    const distance = Math.abs(event.clientY - blockCenterY);
                    
                    if (distance < closestDistance) {
                      closestDistance = distance;
                      closestBlock = block;
                    }
                  }
                  
                  if (closestBlock) {
                    blockElement = closestBlock;
                    const rect = closestBlock.getBoundingClientRect();
                    dropBefore = event.clientY < rect.top + rect.height / 2;
                  }
                }
                
                if (blockElement) {
                  // Get the position of this block in the ProseMirror document
                  try {
                    const blockPos = view.posAtDOM(blockElement, 0);
                    const $blockPos = view.state.doc.resolve(blockPos);
                    
                    // Find the block node at depth 1 (top-level blocks)
                    for (let depth = $blockPos.depth; depth > 0; depth--) {
                      const node = $blockPos.node(depth);
                      
                      if (depth === 1 && this.options.types.includes(node.type.name) && node.attrs.blockId) {
                        targetPos = $blockPos.before(depth);
                        const rect = blockElement.getBoundingClientRect();
                        dropBefore = event.clientY < rect.top + rect.height / 2;
                        break;
                      }
                    }
                  } catch (error) {
                    // Silent fail
                    console.error('ERROR in drop handler:', error);
                  }
                }

                if (targetPos === null) {
                  return false;
                }

                // Calculate insertion position
                let insertPos = targetPos;
                if (!dropBefore) {
                  const targetNode = view.state.doc.nodeAt(targetPos);
                  if (targetNode) {
                    insertPos = targetPos + targetNode.nodeSize;
                  }
                }

                // Don't do anything if dropping in the same place
                if (insertPos === draggedPos) {
                  return true;
                }

                // Perform the move operation
                const tr = view.state.tr;
                
                // Find the actual current position by blockId (the stored draggedPos
                // may be stale if the doc changed during the drag).
                let actualDraggedPos: number | null = null;
                view.state.doc.descendants((node, pos) => {
                  if (node.attrs.blockId === draggedNode.attrs.blockId) {
                    actualDraggedPos = pos;
                    return false;
                  }
                });

                if (actualDraggedPos === null) {
                  console.error('[DROP] Could not find dragged node by blockId');
                  return false;
                }

                // Delete from current position then insert at target.
                tr.delete(actualDraggedPos, actualDraggedPos + draggedNode.nodeSize);

                let finalInsertPos = insertPos;
                if (actualDraggedPos < insertPos) {
                  finalInsertPos = insertPos - draggedNode.nodeSize;
                }

                tr.insert(finalInsertPos, draggedNode);
                view.dispatch(tr);
              } catch (error) {
                console.error('[DROP] Error in drop handler:', error);
              } finally {
                // Stop DOM observer before cleanup (dispatch may have restarted it).
                const domObserver = (view as any).domObserver;
                if (domObserver) domObserver.stop();

                // Clean up drag classes and hide indicator
                hideDropIndicator();
                clearHighlight();
                view.dom
                  .querySelectorAll(".dragging")
                  .forEach((el) => el.classList.remove("dragging"));
              }

              return true;
            },

            dragleave: (view, event) => {
              // Only hide the indicator when the cursor truly leaves the editor.
              // Intra-editor crossings fire dragleave too but are immediately
              // followed by dragover — hiding here would cause a visible flicker.
              const relatedTarget = event.relatedTarget as HTMLElement | null;
              if (!relatedTarget || !view.dom.contains(relatedTarget)) {
                hideDropIndicator();
              }
              return false;
            },
          },
        },
      }),
      // Debug plugin to monitor all table-related changes
      new Plugin({
        appendTransaction: (transactions, oldState, newState) => {
          // Log any changes to table-related nodes
          const tableTypes = ['table', 'tableRow', 'tableHeader', 'tableCell'];
          
          transactions.forEach((tr, trIndex) => {
            if (!tr.docChanged) return;
            
            
            
            // Track table structure before and after
            const oldTables: any[] = [];
            oldState.doc.descendants((node, pos) => {
              if (node.type.name === 'table') {
                oldTables.push({
                  pos,
                  structure: node.toJSON()
                });
              }
            });
            
            const newTables: any[] = [];
            newState.doc.descendants((node, pos) => {
              if (node.type.name === 'table') {
                newTables.push({
                  pos,
                  structure: node.toJSON()
                });
              }
            });
            
            // Check for structural changes
            oldTables.forEach((oldTable, i) => {
              const newTable = newTables[i];
              if (newTable) {
                const oldFirstRow = oldTable.structure.content?.[0];
                const newFirstRow = newTable.structure.content?.[0];
                
                if (oldFirstRow && newFirstRow) {
                  const oldFirstRowCells = oldFirstRow.content || [];
                  const newFirstRowCells = newFirstRow.content || [];
                  
                  // Check if header cells were converted to regular cells
                  const oldHeaders = oldFirstRowCells.filter((c: any) => c.type === 'tableHeader').length;
                  const newHeaders = newFirstRowCells.filter((c: any) => c.type === 'tableHeader').length;
                  
                }
              }
            });
          });
          
          return null; // Don't modify anything, just observe
        },
      }),
    ];
  },
});

export default BlockDragDrop;
