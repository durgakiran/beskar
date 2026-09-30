import React, { useCallback, useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import type { Editor } from '@tiptap/core';
import type { Group, Command } from './groups';
import './SlashCommand.css';

export interface MenuListProps {
  editor: Editor;
  items: Group[];
  command: (command: Command) => void;
}

export const MenuList = forwardRef<any, MenuListProps>((props, ref) => {
  const scrollContainer = useRef<HTMLDivElement>(null);
  const activeItem = useRef<HTMLButtonElement>(null);
  const [selectedGroupIndex, setSelectedGroupIndex] = useState(0);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);

  // Reset selection when items change (user types to filter)
  useEffect(() => {
    setSelectedGroupIndex(0);
    setSelectedCommandIndex(0);
  }, [props.items]);

  const selectItem = useCallback(
    (groupIndex: number, commandIndex: number) => {
      const command = props.items[groupIndex].commands[commandIndex];
      props.command(command);
    },
    [props]
  );

  // Handle keyboard navigation
  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      if (event.key === 'ArrowDown') {
        if (!props.items.length) {
          return false;
        }
        event.preventDefault();

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

      if (event.key === 'ArrowUp') {
        if (!props.items.length) {
          return false;
        }
        event.preventDefault();

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

      if (event.key === 'Enter') {
        if (!props.items.length || selectedGroupIndex === -1 || selectedCommandIndex === -1) {
          return false;
        }
        event.preventDefault();

        selectItem(selectedGroupIndex, selectedCommandIndex);

        return true;
      }

      return false;
    },
  }));

  // Auto-scroll to selected item
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
    [selectItem]
  );

  if (!props.items.length) {
    return null;
  }

  return (
    <div ref={scrollContainer} className="slash-command-menu">
      {props.items.map((group, groupIndex: number) => (
        <div key={`group-${group.name}`} className="slash-command-group">
          {props.items.length > 1 && <div className="slash-command-group-title">{group.title}</div>}
          <div className="slash-command-list">
            {group.commands.map((command: Command, commandIndex: number) => {
              const isSelected =
                selectedGroupIndex === groupIndex && selectedCommandIndex === commandIndex;

              return (
                <button
                  key={`${command.name}`}
                  ref={isSelected ? activeItem : null}
                  onClick={createCommandClickHandler(groupIndex, commandIndex)}
                  className={`slash-command-item ${isSelected ? 'selected' : ''}`}
                >
                  <span className="slash-command-icon">{command.icon}</span>
                  <div className="slash-command-content">
                    <div className="slash-command-label">{command.label}</div>
                    <div className="slash-command-description">{command.description}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
});

MenuList.displayName = 'MenuList';

export default MenuList;
