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
      ],
    };
  },

  addProseMirrorPlugins() {
    // Shared state accessible to both view() and handleDOMEvents
    let draggedBlockInfo: BlockInfo | null = null;
    let isDragging = false;

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
          const { isEditable } = this.editor;

          // Don't create drag handle if editor is not editable
          if (!isEditable) {
            return {};
          }

          let dragHandle: HTMLElement | null = null;
          let currentBlockId: string | null = null;

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
              // So we need to find the node by blockId instead
              const blockId = targetElement.getAttribute('data-block-id');
              if (blockId) {
                let foundBlock: BlockInfo | null = null;
                
                editorView.state.doc.descendants((node, pos) => {
                  if (
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

          const positionHandle = (blockInfo: BlockInfo) => {
            if (!dragHandle) return;

            // Use the DOM element as-is (nodeDOM returns the wrapper for tables)
            let blockElement = blockInfo.dom;
            
            // For React-rendered blocks (like imageBlock), use the inner wrapper for sizing
            if (blockElement.classList.contains('react-renderer') && blockInfo.node.type.name === 'imageBlock') {
              const innerWrapper = blockElement.querySelector('.image-block-container') as HTMLElement;
              if (innerWrapper) {
                // Use inner container for better visual alignment
                blockElement = innerWrapper;
              }
            }
            
            // For details blocks, ensure we're using the details element, not the summary
            if (blockInfo.node.type.name === 'details') {
              // Make sure we're targeting the actual <details> element
              // The summary is a child, so we want to position relative to the parent details
              if (!blockElement.tagName || blockElement.tagName.toLowerCase() !== 'details') {
                const detailsElement = blockElement.closest('details') || blockElement.querySelector('details') || blockElement;
                if (detailsElement && detailsElement !== blockElement) {
                  blockElement = detailsElement as HTMLElement;
                }
              }
            }
            
            const blockRect = blockElement.getBoundingClientRect();
            const parent = container.parentElement;
            if (!parent) return;

            const parentRect = parent.getBoundingClientRect();

            // For tables and images, position handle with appropriate offset
            const isTable = blockInfo.node.type.name === 'table';
            const isImage = blockInfo.node.type.name === 'imageBlock';
            let topOffset = 18;
            
            // Calculate position relative to parent since handle is appended to parent
            const top = blockRect.top - parentRect.top + parent.scrollTop + topOffset;
            // Position at left: 0 (top-left corner of the block)
            const left = blockRect.left - parentRect.left + parent.scrollLeft - 44;

            dragHandle.style.top = `${top}px`;
            dragHandle.style.left = `${left}px`;
            // Height is fixed via CSS (1.25rem)
          };

          const showHandle = (blockInfo: BlockInfo) => {
            if (!dragHandle || isDragging) return;

            const newBlockId = blockInfo.node.attrs.blockId;
            // Only update if switching to a different block
            if (currentBlockId !== newBlockId) {
              currentBlockId = newBlockId;
            }
            positionHandle(blockInfo);
            dragHandle.style.opacity = "1";
          };

          const hideHandle = () => {
            if (!dragHandle || isDragging) return;

            dragHandle.style.opacity = "0";
            // Don't clear currentBlockId immediately - keep it for a short time
            // so drag can work if user grabs the handle quickly
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
                // Make sure handle is visible if we're hovering over it
                if (dragHandle.style.opacity !== "1") {
                  dragHandle.style.opacity = "1";
                }
                return; // Don't change currentBlockId
              }

              // Buffer zone check - if mouse is near the handle
              // Check this even if currentBlockId is null to preserve it
              const handleRect = dragHandle.getBoundingClientRect();
              const mouseX = event.clientX;
              const mouseY = event.clientY;

              // Add a larger buffer zone (50px) to make it easier to reach
              const buffer = 50;
              const inHandleZone =
                mouseX >= handleRect.left - buffer &&
                mouseX <= handleRect.right + buffer &&
                mouseY >= handleRect.top - buffer &&
                mouseY <= handleRect.bottom + buffer;

              if (inHandleZone) {
                // Keep handle visible if in buffer zone
                if (dragHandle.style.opacity !== "1") {
                  dragHandle.style.opacity = "1";
                }
                return; // Don't change currentBlockId
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

            console.log('[DRAG START] Captured draggedBlockInfo:', {
              pos: draggedBlockInfo.pos,
              nodeType: draggedBlockInfo.node.type.name,
              blockId: draggedBlockInfo.node.attrs.blockId,
              nodeSize: draggedBlockInfo.node.nodeSize,
            });
            
            // Log surrounding content
            console.log('[DRAG START] Document structure around dragged node:');
            const startPos = Math.max(0, draggedBlockInfo.pos - 50);
            const endPos = Math.min(editorView.state.doc.content.size, draggedBlockInfo.pos + 150);
            editorView.state.doc.nodesBetween(startPos, endPos, (node, pos) => {
              console.log(`  pos ${pos}: ${node.type.name} (size: ${node.nodeSize}, blockId: ${node.attrs.blockId || 'none'})`);
            });

            isDragging = true;
            
            // CRITICAL: Stop ProseMirror's DOM observer before making DOM changes
            // This prevents readDOMChange from corrupting the document during drag
            const domObserver = (editorView as any).domObserver;
            if (domObserver) {
              console.log('[DRAG START] Stopping DOM observer to prevent corruption');
              domObserver.stop();
            }
            
            blockElement.classList.add("dragging");
            
            // Set drag state in plugin state to prevent table normalization
            // Use a non-document-changing transaction
            const tr = editorView.state.tr;
            tr.setMeta('addToHistory', false);
            tr.setMeta(blockDragDropKey, { 
              isDragging: true, 
              draggedNodeType: draggedBlockInfo.node.type.name 
            });
            tr.setMeta('skipFixTables', true); // Mark this transaction to skip fixTables
            editorView.dispatch(tr);
            
            console.log('[DRAG START] Drag state set, positions should now be frozen');

            if (dragHandle) {
              dragHandle.style.cursor = "grabbing";
            }

            // Set drag data
            if (event.dataTransfer) {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/html", ""); // Required for Firefox

              // Create custom drag image
              try {
                const clone = blockElement.cloneNode(true) as HTMLElement;
                clone.style.opacity = "0.8";
                clone.style.backgroundColor = "gray";
                clone.style.width = `${blockElement.offsetWidth}px`;
                clone.style.position = "absolute";
                clone.style.top = "-9999px";
                clone.style.left = "-9999px";
                
                // For tables, remove grip handles from the clone
                if (blockElement.classList.contains('tableWrapper')) {
                  clone.querySelectorAll('.grip-column, .grip-row').forEach(el => el.remove());
                }
                // Code blocks don't have grip handles, no special handling needed
                
                document.body.appendChild(clone);
                event.dataTransfer.setDragImage(clone, 0, 0);
                setTimeout(() => clone.remove(), 0);
              } catch (e) {
                // Fallback to default drag image
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

                // Clean up dragging classes
                container
                  .querySelectorAll(
                    ".dragging, .drag-over, .drag-over-top, .drag-over-bottom"
                  )
                  .forEach((el) => {
                    el.classList.remove(
                      "dragging",
                      "drag-over",
                      "drag-over-top",
                      "drag-over-bottom"
                    );
                  });

                draggedBlockInfo = null;
                // Clear currentBlockId after drag completes
                currentBlockId = null;
                
                // CRITICAL: Restart ProseMirror's DOM observer
                // This was stopped in handleDragStart to prevent corruption
                const domObserver = (editorView as any).domObserver;
                if (domObserver) {
                  console.log('[DRAG END] Restarting DOM observer');
                  domObserver.start();
                  // Force a flush to sync any pending DOM changes
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

          // Initialize
          // Wait for the container to be in the DOM before creating the handle
          const initHandle = () => {
            if (document.contains(container)) {
              dragHandle = createDragHandle();
            } else {
              setTimeout(initHandle, 10);
            }
          };

          initHandle();

          container.classList.add("has-block-drag-handles");

          // Handler for when mouse leaves the editor
          const handleMouseLeave = () => {
            // Just hide the handle, but DON'T clear currentBlockId
            // This is because mouseleave fires BEFORE dragstart, so we need to preserve
            // currentBlockId for the drag operation to work.
            // currentBlockId will be cleared by:
            // 1. handleDragEnd (after drag completes)
            // 2. showHandle (when switching to a different block)
            hideHandle();
          };
          
          // Event listeners
          container.addEventListener("mousemove", handleMouseMove);
          container.addEventListener("mouseleave", handleMouseLeave);
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
              container.removeEventListener("mousemove", handleMouseMove);
              container.removeEventListener("mouseleave", handleMouseLeave);
              container.removeEventListener("scroll", handleScroll);
              window.removeEventListener("resize", handleScroll);

              if (dragHandle) {
                dragHandle.removeEventListener("dragstart", handleDragStart);
                dragHandle.removeEventListener("dragend", handleDragEnd);
                dragHandle.remove();
                dragHandle = null;
              }

              container.classList.remove("has-block-drag-handles");
            },
          };
        },

        props: {
          handleDOMEvents: {
            dragover: (view, event) => {
              // Check if we're in a drag operation
              if (!isDragging) {
                return false;
              }

              event.preventDefault();
              if (event.dataTransfer) {
                event.dataTransfer.dropEffect = "move";
              }

              // Clear previous indicators
              view.dom
                .querySelectorAll(
                  ".drag-over, .drag-over-top, .drag-over-bottom"
                )
                .forEach((el) => {
                  el.classList.remove(
                    "drag-over",
                    "drag-over-top",
                    "drag-over-bottom"
                  );
                });

              // Find target block
              const pos = view.posAtCoords({
                left: event.clientX,
                top: event.clientY,
              });
              if (!pos) return true;

              const $pos = view.state.doc.resolve(pos.pos);

              // Find closest block node
              for (let depth = $pos.depth; depth > 0; depth--) {
                const node = $pos.node(depth);
                if (
                  this.options.types.includes(node.type.name) &&
                  node.attrs.blockId
                ) {
                  const nodePos = $pos.before(depth);
                  const dom = view.nodeDOM(nodePos) as HTMLElement;

                  if (
                    dom &&
                    dom.classList.contains("block-node") &&
                    !dom.classList.contains("dragging")
                  ) {
                    const rect = dom.getBoundingClientRect();
                    const isTopHalf =
                      event.clientY < rect.top + rect.height / 2;

                    dom.classList.add("drag-over");
                    dom.classList.add(
                      isTopHalf ? "drag-over-top" : "drag-over-bottom"
                    );
                    break;
                  }
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
                let dropBefore = false;
                
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
                        if (dropBefore === undefined) {
                          dropBefore = event.clientY < rect.top + rect.height / 2;
                        }
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
                
                console.log('[DROP] About to delete:', {
                  draggedPos,
                  nodeSize: draggedNode.nodeSize,
                  deleteRange: [draggedPos, draggedPos + draggedNode.nodeSize],
                  draggedNodeType: draggedNode.type.name,
                  draggedNodeBlockId: draggedNode.attrs.blockId,
                });
                
                // Check what's actually at draggedPos right now
                const nodeAtDraggedPos = view.state.doc.nodeAt(draggedPos);
                console.log('[DROP] Node at draggedPos:', {
                  type: nodeAtDraggedPos?.type.name,
                  blockId: nodeAtDraggedPos?.attrs?.blockId,
                  size: nodeAtDraggedPos?.nodeSize,
                });
                
                // Find the actual current position by blockId
                let actualDraggedPos: number | null = null;
                view.state.doc.descendants((node, pos) => {
                  if (node.attrs.blockId === draggedNode.attrs.blockId) {
                    actualDraggedPos = pos;
                    console.log('[DROP] Found dragged node at current pos:', pos);
                    return false;
                  }
                });
                
                if (actualDraggedPos === null) {
                  console.error('[DROP] Could not find dragged node by blockId!');
                  return false;
                }
                
                console.log('[DROP] Using actualDraggedPos:', actualDraggedPos, 'instead of stale draggedPos:', draggedPos);
                
                // Delete the dragged node from its CURRENT position
                tr.delete(actualDraggedPos, actualDraggedPos + draggedNode.nodeSize);
                
                // Adjust insert position if needed
                let finalInsertPos = insertPos;
                if (actualDraggedPos < insertPos) {
                  finalInsertPos = insertPos - draggedNode.nodeSize;
                }
                
                console.log('[DROP] Insert positions:', {
                  originalInsertPos: insertPos,
                  finalInsertPos,
                });
                
                // Insert the node at the target position
                tr.insert(finalInsertPos, draggedNode);
                
                view.dispatch(tr);
              } catch (error) {
                console.error('[DROP] Error in drop handler:', error);
              } finally {
                // CRITICAL: Stop DOM observer again before cleanup
                // view.dispatch might have restarted it, and DOM changes here would trigger corruption
                const domObserver = (view as any).domObserver;
                if (domObserver) {
                  console.log('[DROP] Stopping DOM observer before cleanup');
                  domObserver.stop();
                }
                
                // Clean up
                view.dom
                  .querySelectorAll(
                    ".dragging, .drag-over, .drag-over-top, .drag-over-bottom"
                  )
                  .forEach((el) => {
                    el.classList.remove(
                      "dragging",
                      "drag-over",
                      "drag-over-top",
                      "drag-over-bottom"
                    );
                  });
              }

              return true;
            },

            dragleave: (view, event) => {
              const target = event.target as HTMLElement;
              if (target.classList?.contains("block-node")) {
                target.classList.remove(
                  "drag-over",
                  "drag-over-top",
                  "drag-over-bottom"
                );
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
