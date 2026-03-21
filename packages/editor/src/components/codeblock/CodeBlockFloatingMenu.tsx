/**
 * CodeBlockFloatingMenu - Floating menu for code block operations
 * Shows language selection, copy, and delete options
 */

import React, { useEffect, useState, useRef } from 'react';
import { Editor, findParentNode } from '@tiptap/core';
import { FiCopy, FiTrash2, FiChevronDown } from 'react-icons/fi';
import * as Toolbar from '@radix-ui/react-toolbar';
import * as Separator from '@radix-ui/react-separator';
import { createLowlight, common } from 'lowlight';

// Get available languages from lowlight
const lowlight = createLowlight(common);
const AVAILABLE_LANGUAGES = lowlight.listLanguages().sort();

const LANGUAGE_LABELS: Record<string, string> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  python: 'Python',
  java: 'Java',
  cpp: 'C++',
  csharp: 'C#',
  php: 'PHP',
  ruby: 'Ruby',
  go: 'Go',
  rust: 'Rust',
  swift: 'Swift',
  kotlin: 'Kotlin',
  scala: 'Scala',
  html: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  less: 'Less',
  json: 'JSON',
  xml: 'XML',
  markdown: 'Markdown',
  bash: 'Bash',
  shell: 'Shell',
  sql: 'SQL',
  plaintext: 'Plain Text',
};

interface CodeBlockFloatingMenuProps {
  editor: Editor;
}

export const CodeBlockFloatingMenu: React.FC<CodeBlockFloatingMenuProps> = ({ editor }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0, isBottom: true });
  const [currentLanguage, setCurrentLanguage] = useState<string>('plaintext');
  const [codeBlockPos, setCodeBlockPos] = useState<number>(-1);
  const [showLanguageDropdown, setShowLanguageDropdown] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const findCodeBlock = () => {
    const { state, view } = editor;
    const { selection } = state;

    // Use findParentNode to find code block
    const codeBlock = findParentNode(
      (node) => node.type.name === 'codeBlock' || node.type.name === 'codeBlockLowlight'
    )(selection);

    if (!codeBlock) {
      return null;
    }

    const dom = view.nodeDOM(codeBlock.pos);
    return {
      node: codeBlock.node,
      pos: codeBlock.pos,
      dom,
      typeName: codeBlock.node.type.name,
    };
  };

  const handleCopy = () => {
    const codeBlock = findCodeBlock();
    if (!codeBlock) return;
    console.log('codeBlock', codeBlock);

    // Select the entire code block node (preserves structure and attributes like language)
    editor.chain()
      .focus()
      .setNodeSelection(codeBlock.pos)
      .run();

    // Give the selection a moment to update, then trigger copy
    setTimeout(() => {
      try {
        // Trigger the browser's copy command (this preserves node structure)
        document.execCommand('copy');
        // Restore focus
        editor.commands.focus();
      } catch (err) {
        console.error('[CodeBlockFloatingMenu] Failed to execute copy command:', err);
        // Fallback: copy text content if execCommand fails
        const code = codeBlock.node.textContent;
        navigator.clipboard.writeText(code);
      }
    }, 10);
  };

  const handleDelete = () => {
    const codeBlock = findCodeBlock();
    if (!codeBlock) return;

    const { state, view } = editor;
    console.log('codeBlock', codeBlock);
    const tr = state.tr.delete(codeBlock.pos, codeBlock.pos + codeBlock.node.nodeSize);
    view.dispatch(tr);
    editor.view.focus();
  };

  const handleLanguageChange = (language: string) => {
    const codeBlock = findCodeBlock();
    if (!codeBlock) return;

    const { state, view } = editor;
    const tr = state.tr.setNodeMarkup(codeBlock.pos, undefined, {
      ...codeBlock.node.attrs,
      language: language === 'plaintext' ? null : language,
    });
    view.dispatch(tr);
    setCurrentLanguage(language);
  };

  const getLanguageLabel = (lang: string) => {
    return LANGUAGE_LABELS[lang] || lang.charAt(0).toUpperCase() + lang.slice(1);
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        menuRef.current &&
        !menuRef.current.contains(event.target as Node)
      ) {
        setShowLanguageDropdown(false);
      }
    };

    if (showLanguageDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [showLanguageDropdown]);

  useEffect(() => {
    const updateMenu = () => {
      const codeBlock = findCodeBlock();

      if (!codeBlock || !editor.isEditable) {
        setIsVisible(false);
        setShowLanguageDropdown(false);
        return;
      }

      // Code block is active, show menu
      setIsVisible(true);
      setCodeBlockPos(codeBlock.pos);

      // Get current language
      const language = codeBlock.node.attrs.language || null || 'plaintext';
      setCurrentLanguage(language || 'plaintext');

      // Get the code block wrapper DOM element for positioning
      if (codeBlock.dom) {
        let wrapperElement: HTMLElement | null = null;
        
        if (codeBlock.dom instanceof HTMLElement) {
          // The dom is now the wrapper div, or find it
          wrapperElement = codeBlock.dom.classList?.contains('code-block-wrapper')
            ? codeBlock.dom
            : codeBlock.dom.closest?.('.code-block-wrapper') || codeBlock.dom;
        } else {
          // Try to get the wrapper element
          const htmlDom = codeBlock.dom as any;
          if (htmlDom?.classList?.contains?.('code-block-wrapper')) {
            wrapperElement = htmlDom;
          } else if (htmlDom?.closest) {
            wrapperElement = htmlDom.closest('.code-block-wrapper');
          } else if (htmlDom?.parentElement) {
            wrapperElement = htmlDom.parentElement.closest?.('.code-block-wrapper') || null;
          }
        }

        if (wrapperElement) {
          const rect = wrapperElement.getBoundingClientRect();
          const spaceBelow = window.innerHeight - rect.bottom;

          if (spaceBelow >= 60) {
            setPosition({
              x: rect.left + rect.width / 2,
              y: rect.bottom + 10,
              isBottom: true,
            });
          } else {
            setPosition({
              x: rect.left + rect.width / 2,
              y: rect.top - 10,
              isBottom: false,
            });
          }
        }
      }
    };

    // Update on selection/transaction changes
    editor.on('selectionUpdate', updateMenu);
    editor.on('transaction', updateMenu);
    editor.on('focus', updateMenu);
    editor.on('blur', () => setIsVisible(false));

    // Initial update
    updateMenu();

    return () => {
      editor.off('selectionUpdate', updateMenu);
      editor.off('transaction', updateMenu);
      editor.off('focus', updateMenu);
      editor.off('blur', () => setIsVisible(false));
    };
  }, [editor]);

  if (!isVisible) {
    return null;
  }

  return (
    <div
      ref={menuRef}
      className="code-block-floating-menu-container"
      style={{
        position: 'fixed',
        left: `${position.x}px`,
        top: `${position.y}px`,
        transform: `translate(-50%, ${position.isBottom ? '0' : '-100%'})`,
        zIndex: 50,
      }}
      onMouseDown={(e) => {
        // Prevent editor from losing focus
        e.preventDefault();
      }}
    >
      <Toolbar.Root className="editor-floating-toolbar">
        {/* Copy Button */}
        <Toolbar.Button
          className="editor-floating-toolbar-button"
          onClick={handleCopy}
          aria-label="Copy code"
          title="Copy code"
        >
          <FiCopy size={16} />
          <span>Copy</span>
        </Toolbar.Button>

        {/* Delete Button */}
        <Toolbar.Button
          className="editor-floating-toolbar-button"
          onClick={handleDelete}
          aria-label="Delete code block"
          title="Delete code block"
        >
          <FiTrash2 size={16} />
          <span>Delete</span>
        </Toolbar.Button>

        <Separator.Root className="editor-floating-toolbar-separator" orientation="vertical" />

        {/* Language Selector */}
        <div className="code-block-language-select-wrapper" ref={dropdownRef}>
          <button
            className="code-block-language-select"
            onClick={() => setShowLanguageDropdown(!showLanguageDropdown)}
            aria-label="Select language"
            aria-expanded={showLanguageDropdown}
          >
            <span>{getLanguageLabel(currentLanguage)}</span>
            <FiChevronDown size={14} className={showLanguageDropdown ? 'rotated' : ''} />
          </button>

          {showLanguageDropdown && (
            <div className="code-block-language-dropdown">
              <div className="code-block-language-dropdown-content">
                {AVAILABLE_LANGUAGES.map((lang) => (
                  <button
                    key={lang}
                    className={`code-block-language-option ${
                      currentLanguage === lang ? 'selected' : ''
                    }`}
                    onClick={() => {
                      handleLanguageChange(lang);
                      setShowLanguageDropdown(false);
                    }}
                  >
                    {getLanguageLabel(lang)}
                    {currentLanguage === lang && <span className="checkmark">✓</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </Toolbar.Root>
    </div>
  );
};

