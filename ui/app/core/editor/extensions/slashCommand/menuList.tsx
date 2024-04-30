import { Editor } from "@tiptap/core";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Group } from "./groups";
import { icons } from "lucide-react";
import { Surface } from "./surface";
import { Dropdown } from "flowbite-react";

interface MenuListProps {
  editor: Editor
  items: Group[]
  command: (command: Command) => void
}

export interface Command {
  name: string
  label: string
  description: string
  aliases?: string[]
  iconName: keyof typeof icons
  action: (editor: Editor) => void
  shouldBeHidden?: (editor: Editor) => boolean
}

export const MenuList = React.forwardRef((props: MenuListProps, ref) => {
    const scrollContainer = useRef<HTMLDivElement>(null);
    const activeItem = useRef<HTMLButtonElement>(null);
    const [selectedGroupIndex, setSelectedGroupIndex] = useState(0);
    const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);

    // Anytime the groups change, i.e. the user types to narrow it down, we want to
    // reset the current selection to the first menu item
    useEffect(() => {
        setSelectedGroupIndex(0);
        setSelectedCommandIndex(0);
    }, [props.items]);

    const selectItem = useCallback(
        (groupIndex: number, commandIndex: number) => {
            const command = props.items[groupIndex].commands[commandIndex];
            props.command(command);
        },
        [props],
    );

    React.useImperativeHandle(ref, () => ({
        onKeyDown: ({ event }: { event: React.KeyboardEvent }) => {
            if (event.key === "ArrowDown") {
                if (!props.items.length) {
                    return false;
                }

                const commands = props.items[selectedGroupIndex].commands;

                let newCommandIndex = selectedCommandIndex + 1;
                let newGroupIndex = selectedGroupIndex;

                if (commands.length - 1 < newCommandIndex) {
                    newCommandIndex = 0;
                    newGroupIndex = selectedGroupIndex + 1;
                }

                if (props.items.length - 1 < newGroupIndex) {
                    newGroupIndex = 0;
                }

                setSelectedCommandIndex(newCommandIndex);
                setSelectedGroupIndex(newGroupIndex);

                return true;
            }

            if (event.key === "ArrowUp") {
                if (!props.items.length) {
                    return false;
                }

                let newCommandIndex = selectedCommandIndex - 1;
                let newGroupIndex = selectedGroupIndex;

                if (newCommandIndex < 0) {
                    newGroupIndex = selectedGroupIndex - 1;
                    newCommandIndex = props.items[newGroupIndex]?.commands.length - 1 || 0;
                }

                if (newGroupIndex < 0) {
                    newGroupIndex = props.items.length - 1;
                    newCommandIndex = props.items[newGroupIndex].commands.length - 1;
                }

                setSelectedCommandIndex(newCommandIndex);
                setSelectedGroupIndex(newGroupIndex);

                return true;
            }

            if (event.key === "Enter") {
                if (!props.items.length || selectedGroupIndex === -1 || selectedCommandIndex === -1) {
                    return false;
                }

                selectItem(selectedGroupIndex, selectedCommandIndex);

                return true;
            }

            return false;
        },
    }));

    useEffect(() => {
        if (activeItem.current && scrollContainer.current) {
            const offsetTop = activeItem.current.offsetTop;
            const offsetHeight = activeItem.current.offsetHeight;

            scrollContainer.current.scrollTop = offsetTop - offsetHeight;
        }
    }, [selectedCommandIndex, selectedGroupIndex]);

    const createCommandClickHandler = useCallback(
        (groupIndex: number, commandIndex: number) => {
            return () => {
                selectItem(groupIndex, commandIndex);
            };
        },
        [selectItem],
    );

    if (!props.items.length) {
        return null;
    }

    return (
        <Surface ref={scrollContainer} className="text-black max-h-[min(80vh,24rem)] overflow-auto flex-wrap mb-8 p-2">
            <div className="bg-white p-2 grid grid-cols-1 gap-0.5 shado">
                {props.items.map((group, groupIndex: number) => (
                    <React.Fragment key={`${group.title}-wrapper`}>
                        {group.commands.map((command: Command, commandIndex: number) => (
                            <button
                                key={`${command.label}`}
                                onClick={createCommandClickHandler(groupIndex, commandIndex)}
                                className="px-2 hover:bg-slate-200 py-1 rounded text-left"
                            >
                                {/* <Icon name={command.iconName} className="mr-1" /> */}
                                {command.label}
                            </button>
                        ))}
                    </React.Fragment>
                ))}
            </div>
        </Surface>
    );
});

MenuList.displayName = "MenuList";

export default MenuList;
