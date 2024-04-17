import ModifiedIcon from "@components/modifiedIcon";
import { Editor } from "@tiptap/react";
import { useEffect, useState } from "react";
import { useContentAlignTypes } from "./hooks/useContentAlignTypes";
import { ContentAlignTypePickerOption } from "./types";
import { HiMenuAlt2,HiMenuAlt3,HiOutlineMenu  }  from "react-icons/hi";
interface ContentAlignPickerOption {
    editor: Editor;
}

export default function ContentAlignPicker({ editor }: ContentAlignPickerOption) {
    const [open, setOpen] = useState(false);
    const options = useContentAlignTypes(editor);
    const [activeItem, setActiveItem] = useState<ContentAlignTypePickerOption>();

    const alignmentTypes = [
        { icon: HiMenuAlt2, alignment: 'left', tooltip: 'Align Left' },
        { icon: HiMenuAlt3, alignment: 'right', tooltip: 'Align Right' },
        { icon: HiOutlineMenu, alignment: 'center', tooltip: 'Align Center' }
    ];

    useEffect(() => {
            
            if (editor) {
                const updateActiveItem = () => {
                    // Assuming there's a way to get the current alignment from the editor
                    const currentAlignment = editor.getAttributes('paragraph').textAlign;
                    setActiveItem(currentAlignment || 'left');
                };
    
                editor.on('selectionUpdate', updateActiveItem);
                editor.on('transaction', updateActiveItem);
    
                return () => {
                    editor.off('selectionUpdate', updateActiveItem);
                    editor.off('transaction', updateActiveItem);
                };
            }
        }, [editor]);
    
        // Function to apply alignment to the content
        const handleIconClick = (alignment) => {
            if (editor) {
                editor.chain().focus().setNode('paragraph', { textAlign: alignment }).run();
                setActiveItem(alignment); // Update active item to reflect current alignment
            }
        };

    return (

        <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {alignmentTypes.map((type) => {
                    const Icon = type.icon;
                    return (
                        <Icon
                            key={type.alignment}
                            onClick={() => handleIconClick(type.alignment)}
                            style={{ cursor: 'pointer', color: 'black' }} 
                            title={type.tooltip}
                        />
                    );
                })}
            </div>
        </div>
       /* <ActionMenu open={open} onOpenChange={setOpen}>
            <ActionMenu.Button disabled={!activeItem} variant="invisible"> 
                <ModifiedIcon name={activeItem ? activeItem.icon : "Alignleft"} size={16} />
            </ActionMenu.Button>
            <ActionMenu.Overlay>
                <ActionList sx={{ display: "flex", alignItems: "center" }}>
                    {
                        options.map((item, i) => (
                            <ActionList.Item key={i} onClick={() => {item.onClick(); setOpen(false) }} disabled={item.disabled()}  >
                                <ActionList.LeadingVisual>
                                    <ModifiedIcon name={item.icon} size={16} />
                                </ActionList.LeadingVisual>
                                {/* <ActionList.TrailingVisual sx={{ color: "fg.subtle" }}>æ⌥1</ActionList.TrailingVisual>*}
                            </ActionList.Item>
                        ))
                    }
                </ActionList>
            </ActionMenu.Overlay>
        </ActionMenu>*/
    )
}
