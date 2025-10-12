import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

// BlockDragDrop extension loaded

export interface BlockDragDropOptions {
  types: string[];
}

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
        "blockquote",
        "codeBlock",
        "table",
        "horizontalRule",
      ],
    };
  },

  addProseMirrorPlugins() {
    // Shared state accessible to both view() and handleDOMEvents
    let draggedBlockInfo: BlockInfo | null = null;
    let isDragging = false;

    return [
      new Plugin({
        key: new PluginKey("blockDragDrop"),

        view: (editorView) => {
          const container = editorView.dom as HTMLElement;

          let dragHandle: HTMLElement | null = null;
          let currentBlockId: string | null = null;

          // Create single drag handle
          const createDragHandle = () => {
            const handle = document.createElement("button");
            handle.className = "block-drag-handle";
            handle.textContent = "⋮⋮";
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
              // Silent fail
            }
            return null;
          };

          const findBlockFromElement = (
            element: HTMLElement
          ): BlockInfo | null => {
            try {
              // Get position from the element
              let pos = editorView.posAtDOM(element, 0);
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
              // Silent fail
            }
            return null;
          };

          const positionHandle = (blockInfo: BlockInfo) => {
            if (!dragHandle) return;

            const blockRect = blockInfo.dom.getBoundingClientRect();
            const parent = container.parentElement;
            if (!parent) return;

            const parentRect = parent.getBoundingClientRect();

            // Calculate position relative to parent since handle is appended to parent
            const top = blockRect.top - parentRect.top + parent.scrollTop;
            const left =
              blockRect.left - parentRect.left + parent.scrollLeft - 32;

            dragHandle.style.top = `${top}px`;
            dragHandle.style.left = `${Math.max(left, 4)}px`;
            dragHandle.style.height = `${Math.min(blockRect.height, 24)}px`;
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
            const elementUnderMouse = document.elementFromPoint(
              event.clientX,
              event.clientY
            ) as HTMLElement;
            if (!elementUnderMouse) return;

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

            if (!blockElement) return;

            draggedBlockInfo = findBlockFromElement(blockElement);
            if (!draggedBlockInfo) return;

            isDragging = true;
            blockElement.classList.add("dragging");

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
                clone.style.width = `${blockElement.offsetWidth}px`;
                clone.style.position = "absolute";
                clone.style.top = "-9999px";
                clone.style.left = "-9999px";
                document.body.appendChild(clone);
                event.dataTransfer.setDragImage(clone, 0, 0);
                setTimeout(() => clone.remove(), 0);
              } catch (e) {
                // Fallback to default drag image
              }
            }
          };

          const handleDragEnd = () => {
            isDragging = false;

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

                // Adjust if dragging downwards
                if (draggedPos < insertPos) {
                  insertPos -= draggedNode.nodeSize;
                }

                // Don't do anything if dropping in the same place
                if (insertPos === draggedPos) {
                  return true;
                }

                // Perform the move
                const tr = view.state.tr;
                tr.delete(draggedPos, draggedPos + draggedNode.nodeSize);
                tr.insert(insertPos, draggedNode);
                view.dispatch(tr);
              } catch (error) {
                // Silent fail
              } finally {
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
    ];
  },
});

export default BlockDragDrop;
