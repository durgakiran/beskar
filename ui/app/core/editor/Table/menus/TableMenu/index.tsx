import { BubbleMenu as BaseBubbleMenu } from "@tiptap/react";
import React, { useCallback, useState, useEffect } from "react";
import * as PopoverMenu from "@components/ui/PopoverMenu";
import { Tooltip } from "flowbite-react";

import { Toolbar } from "@components/ui/Toolbar";
import { isTableSelected, getTablePosition } from "./utils";
import { Icon } from "@components/ui/Icon";
import { MenuProps, ShouldShowProps } from "@components/menus/types";

export const TableMenu = React.memo(({ editor, appendTo }: MenuProps): JSX.Element => {
    const [placement, setPlacement] = useState<"top" | "bottom">("top");
    const [hoverState, setHoverState] = useState<"copy" | "delete" | null>(null);

    const shouldShow = useCallback(
        ({ view, state, from }: ShouldShowProps) => {
            if (!state || !from) {
                return false;
            }

            const isSelected = isTableSelected({ editor, view, state, from });
            if (isSelected) {
                const tablePos = getTablePosition({ view, state, from });
                setPlacement(tablePos);
            }
            return isSelected;
        },
        [editor],
    );

    const onDeleteTable = useCallback(() => {
        editor.chain().focus().deleteTable().run();
    }, [editor]);

    const onCopyTable = useCallback(() => {
        // Get the current table content and copy it to clipboard
        const { view } = editor;
        const { state } = view;
        const tableElement = view.dom.querySelector('table');
        
        if (tableElement) {
            const tableHTML = tableElement.outerHTML;
            navigator.clipboard.writeText(tableHTML).then(() => {
                // You could add a toast notification here
                console.log('Table copied to clipboard');
            }).catch(err => {
                console.error('Failed to copy table:', err);
            });
        }
    }, [editor]);

    const onAddRowBefore = useCallback(() => {
        editor.chain().focus().addRowBefore().run();
    }, [editor]);

    const onAddRowAfter = useCallback(() => {
        editor.chain().focus().addRowAfter().run();
    }, [editor]);

    const onAddColumnBefore = useCallback(() => {
        editor.chain().focus().addColumnBefore().run();
    }, [editor]);

    const onAddColumnAfter = useCallback(() => {
        editor.chain().focus().addColumnAfter().run();
    }, [editor]);

    // Apply hover effects to table wrapper
    useEffect(() => {
        if (!editor || !editor.view) return;
        
        const tableWrapper = editor.view.dom.querySelector('.tableWrapper');
        console.log('TableMenu hover effect:', { hoverState, tableWrapper: !!tableWrapper });
        
        if (tableWrapper) {
            // Remove all hover classes first
            tableWrapper.classList.remove('copy-hover', 'delete-hover');
            
            // Add the appropriate hover class
            if (hoverState === 'copy') {
                tableWrapper.classList.add('copy-hover');
                console.log('Added copy-hover class');
            } else if (hoverState === 'delete') {
                tableWrapper.classList.add('delete-hover');
                console.log('Added delete-hover class');
            }
        }
    }, [hoverState, editor]);



    return (
        <BaseBubbleMenu
            editor={editor}
            pluginKey="tableMenu"
            updateDelay={0}
            tippyOptions={{
                appendTo: () => {
                    return appendTo?.current;
                },
                placement: placement,
                offset: [0, 15],
                popperOptions: {
                    modifiers: [{ name: "flip", enabled: false }],
                },
                getReferenceClientRect: () => {
                    // Get the table element to position the menu relative to the table
                    const { view } = editor;
                    const { state } = view;
                    
                    // Find table element from current position
                    const domAtPos = view.domAtPos(state.selection.from).node as HTMLElement;
                    const tableElement = domAtPos?.closest('table');
                    
                    if (tableElement) {
                        const rect = tableElement.getBoundingClientRect();
                        return new DOMRect(
                            rect.left,
                            placement === "top" ? rect.top - 15 : rect.bottom + 15,
                            rect.width,
                            0
                        );
                    }
                    
                    // Fallback to default positioning
                    const coords = view.coordsAtPos(state.selection.from);
                    return new DOMRect(coords.left, coords.top, 0, 0);
                }
            }}
            shouldShow={shouldShow}
        >
                        <Toolbar.Wrapper>
                {/* Rows and Columns Unit */}
                <Tooltip content="Add row before">
                    <PopoverMenu.Item iconComponent={<Icon name="ArrowUpToLine" />} close={false} label="" onClick={onAddRowBefore} />
                </Tooltip>
                <Tooltip content="Add row after">
                    <PopoverMenu.Item iconComponent={<Icon name="ArrowDownToLine" />} close={false} label="" onClick={onAddRowAfter} />
                </Tooltip>
                <Tooltip content="Add column before">
                    <PopoverMenu.Item iconComponent={<Icon name="ArrowLeftToLine" />} close={false} label="" onClick={onAddColumnBefore} />
                </Tooltip>
                <Tooltip content="Add column after">
                    <PopoverMenu.Item iconComponent={<Icon name="ArrowRightToLine" />} close={false} label="" onClick={onAddColumnAfter} />
                </Tooltip>
                
                {/* Separator */}
                <div className="w-px h-6 bg-gray-300 mx-2" />
                
                {/* Copy Unit */}
                <Tooltip content="Copy table">
                    <div 
                        onMouseEnter={() => {
                            console.log('Copy button mouse enter');
                            setHoverState('copy');
                        }}
                        onMouseLeave={() => {
                            console.log('Copy button mouse leave');
                            setHoverState(null);
                        }}
                    >
                        <PopoverMenu.Item 
                            icon="Copy" 
                            close={false} 
                            label="" 
                            onClick={onCopyTable}
                        />
                    </div>
                </Tooltip>
                
                {/* Separator */}
                <div className="w-px h-6 bg-gray-300 mx-2" />
                
                {/* Delete Unit */}
                <Tooltip content="Delete table">
                    <div 
                        onMouseEnter={() => {
                            console.log('Delete button mouse enter');
                            setHoverState('delete');
                        }}
                        onMouseLeave={() => {
                            console.log('Delete button mouse leave');
                            setHoverState(null);
                        }}
                    >
                        <PopoverMenu.Item icon="Trash" close={false} label="" onClick={onDeleteTable} />
                    </div>
                </Tooltip>
            </Toolbar.Wrapper>
        </BaseBubbleMenu>
    );
});

TableMenu.displayName = "TableMenu";

export default TableMenu;
