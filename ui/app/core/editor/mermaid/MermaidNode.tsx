import { Node, NodeViewProps, mergeAttributes } from "@tiptap/core";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { autoUpdate, flip, offset, shift, useClick, useFloating, useInteractions } from "@floating-ui/react";
import { GenericFloatingOptions } from "@editor/utils/GenericFloatingOptions";
import { MdContentCopy, MdDelete, MdViewColumn, MdViewStream, MdZoomIn, MdZoomOut } from "react-icons/md";
import mermaid from "mermaid";

// Initialize Mermaid with default configuration
mermaid.initialize({
    startOnLoad: false,
    theme: "default",
    securityLevel: "loose",
    fontFamily: "inherit",
});

// Diagram type examples
const diagramExamples = {
    flowchart: `graph TD
    A[Start] --> B{Is it?}
    B -->|Yes| C[OK]
    C --> D[Rethink]
    D --> B
    B ---->|No| E[End]`,
    
    sequence: `sequenceDiagram
    participant Alice
    participant Bob
    Alice->>John: Hello John, how are you?
    loop Healthcheck
        John->>John: Fight against hypochondria
    end
    Note right of John: Rational thoughts <br/>prevail!
    John-->>Alice: Great!
    John->>Bob: How about you?
    Bob-->>John: Jolly good!`,
    
    class: `classDiagram
    class Animal {
        +String name
        +int age
        +eat()
        +sleep()
    }
    class Dog {
        +String breed
        +bark()
    }
    class Cat {
        +String color
        +meow()
    }
    Animal <|-- Dog
    Animal <|-- Cat`,
    
    state: `stateDiagram-v2
    [*] --> Still
    Still --> [*]
    Still --> Moving
    Moving --> Still
    Moving --> Crash
    Crash --> [*]`,
    
    er: `erDiagram
    CUSTOMER ||--o{ ORDER : places
    ORDER ||--|{ LINE-ITEM : contains
    CUSTOMER }|..|{ DELIVERY-ADDRESS : uses`,
    
    gantt: `gantt
    title A Gantt Diagram
    dateFormat  YYYY-MM-DD
    section Section
    A task           :a1, 2014-01-01, 30d
    Another task     :after a1  , 20d
    section Another
    Task in sec      :2014-01-12  , 12d
    another task      : 24d`,
    
    journey: `journey
    title My working day
    section Go to work
      Make tea: 5: Me
      Go upstairs: 3: Me
      Do work: 1: Me, Cat
    section Go home
      Go downstairs: 5: Me
      Sit down: 5: Me`,
    
    git: `gitGraph
    commit
    commit
    branch develop
    checkout develop
    commit
    commit
    checkout main
    merge develop
    commit
    commit`,
    
    pie: `pie title Pets adopted by volunteers
    "Dogs" : 386
    "Cats" : 85
    "Rats" : 15`,
    
    block: `block-beta
    columns 3
    A B C
    D E F
    G H I`
};

const diagramTypes = [
    { value: 'flowchart', label: 'Flow chart' },
    { value: 'sequence', label: 'Sequence' },
    { value: 'class', label: 'Class' },
    { value: 'state', label: 'State' },
    { value: 'er', label: 'Relation' },
    { value: 'gantt', label: 'Gantt' },
    { value: 'journey', label: 'User journey' },
    { value: 'git', label: 'Git' },
    { value: 'pie', label: 'Pie' },
    { value: 'block', label: 'Block (beta)' }
];

// Start With Menu Component
const StartWithMenu = ({ 
    selectedType, 
    onTypeChange, 
    diagramTypes 
}: { 
    selectedType: string; 
    onTypeChange: (type: string) => void; 
    diagramTypes: Array<{ value: string; label: string }>; 
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    // Close menu when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as any)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    const handleItemClick = (value: string) => {
        onTypeChange(value);
        setIsOpen(false);
    };

    return (
        <div className="mermaid-start-with-menu" ref={menuRef} contentEditable={false}>
            <button
                className="mermaid-start-with-button"
                onClick={() => setIsOpen(!isOpen)}
                type="button"
            >
                <span className="mermaid-start-with-text">Start with...</span>
                <span className={`mermaid-start-with-arrow ${isOpen ? 'open' : ''}`}>▼</span>
            </button>
            
            {isOpen && (
                <div className="mermaid-start-with-panel">
                    {diagramTypes.map(type => (
                        <button
                            key={type.value}
                            className={`mermaid-start-with-item`}
                            onClick={() => handleItemClick(type.value)}
                            type="button"
                        >
                            {type.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};


const MermaidNodeComponent = ({ node, updateAttributes, editor, getPos }: NodeViewProps) => {
    const [title, setTitle] = useState((node.attrs as any).title || "");
    const [selectedType, setSelectedType] = useState("flowchart");
    const [error, setError] = useState<string | null>(null);
    const [isValid, setIsValid] = useState(true);
    const [isOpen, setIsOpen] = useState(false);
    const [isActive, setIsActive] = useState(false);
    const [layout, setLayout] = useState<'horizontal' | 'vertical'>((node.attrs as any).layout || 'horizontal');
    const [zoom, setZoom] = useState<number>((node.attrs as any).zoom || 1);
    const [panPosition, setPanPosition] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const renderRef = useRef<HTMLDivElement>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    
    // Floating UI setup
    const { refs, floatingStyles, context } = useFloating({ 
        whileElementsMounted: autoUpdate, 
        open: isOpen, 
        onOpenChange: setIsOpen,
        middleware: [offset(10), flip(), shift()] 
    });
    const click = useClick(context);
    const { getReferenceProps, getFloatingProps } = useInteractions([click]);

    // Handle wrapper click for drag functionality
    const handleWrapperClick = (e: React.MouseEvent) => {
        // Check if this is a drag attempt
        const target = e.target as HTMLElement;
        const isDiagramContainer = target.closest('.mermaid-diagram-container') || target.closest('.mermaid-display-diagram');
        
        if (isDiagramContainer) {
            // Don't handle as wrapper click, let drag handlers take over
            return;
        }
        
        // For interactive elements, don't interfere with their focus
        const isInteractive = target.tagName === 'TEXTAREA' || 
                            target.tagName === 'INPUT' || 
                            target.tagName === 'SELECT' ||
                            target.tagName === 'BUTTON' ||
                            target.closest('.mermaid-start-with-menu');
        
        if (isInteractive) {
            // Let interactive elements handle their own focus
            return;
        }
        
        // For other elements, let Floating UI handle the click
        // No need to manually manage isActive or isOpen
    };



          // Simple active state based on floating options being open
          useEffect(() => {
              setIsActive(isOpen);
          }, [isOpen]);




    // Floating options handlers
    const handleDelete = () => {
        const pos = getPos();
        
        // Replace the mermaid node with a paragraph
        editor.chain()
            .focus()
            .deleteRange({ from: pos, to: pos + node.nodeSize })
            .insertContentAt(pos, { type: 'paragraph', content: [{ type: 'text', text: '' }] })
            .run();
    };

    const handleCopy = () => {
        // Create a JSON representation of the node for clipboard
        const nodeData = {
            type: "mermaid",
            attrs: {
                title: (node.attrs as any).title || "",
                layout: (node.attrs as any).layout || "horizontal",
                zoom: (node.attrs as any).zoom || 1
            },
            content: [{ type: 'text', text: getCurrentDiagram() }]
        };
        
        // Copy to clipboard as JSON
        navigator.clipboard.writeText(JSON.stringify(nodeData)).catch(err => {
            console.error("Failed to copy node:", err);
        });
    };

    const handleLayoutChange = (newLayout: 'horizontal' | 'vertical') => {
        setLayout(newLayout);
        updateAttributes({ layout: newLayout });
    };

    const handleZoomIn = () => {
        const newZoom = Math.min(zoom + 0.25, 3); // Max zoom 3x
        setZoom(newZoom);
        updateAttributes({ zoom: newZoom });
        // Reset pan position when zooming to center
        if (newZoom === 1) {
            setPanPosition({ x: 0, y: 0 });
        }
    };

    const handleZoomOut = () => {
        const newZoom = Math.max(zoom - 0.25, 0.25); // Min zoom 0.25x
        setZoom(newZoom);
        updateAttributes({ zoom: newZoom });
        // Reset pan position when zooming to center
        if (newZoom === 1) {
            setPanPosition({ x: 0, y: 0 });
        }
    };


    // Mouse event handlers for dragging
    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        
        setIsDragging(true);
        const newDragStart = { x: e.clientX - panPosition.x, y: e.clientY - panPosition.y };
        setDragStart(newDragStart);
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isDragging) return;
        
        e.preventDefault();
        e.stopPropagation();
        setPanPosition({
            x: e.clientX - dragStart.x,
            y: e.clientY - dragStart.y
        });
    };

    const handleMouseUp = (e: React.MouseEvent) => {
        if (isDragging) {
            e.preventDefault();
            e.stopPropagation();
        }
        setIsDragging(false);
    };

    // Define floating options
    const floatingOptions = [
        {
            label: "Copy",
            icon: <MdContentCopy />,
            onClick: handleCopy
        },
        {
            label: "Horizontal Layout",
            icon: <MdViewColumn />,
            onClick: () => handleLayoutChange('horizontal'),
            className: layout === 'horizontal' ? 'bg-blue-100 text-blue-600' : ''
        },
        {
            label: "Vertical Layout",
            icon: <MdViewStream />,
            onClick: () => handleLayoutChange('vertical'),
            className: layout === 'vertical' ? 'bg-blue-100 text-blue-600' : ''
        },
        {
            label: "Delete",
            icon: <MdDelete />,
            onClick: handleDelete
        }
    ];

    // Function to validate and render Mermaid diagram
    const renderDiagram = async (mermaidCode: string) => {
        if (!renderRef.current) return;

        try {
            // Clear previous content
            renderRef.current.innerHTML = "";

            if (!mermaidCode.trim()) {
                renderRef.current.innerHTML = `
                    <div style="
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        height: 100%;
                        color: #6b7280;
                        font-size: 14px;
                        text-align: center;
                    ">
                        <div>
                            <div style="font-size: 24px; margin-bottom: 8px;">📊</div>
                            <div>Your diagram will appear here</div>
                        </div>
                    </div>
                `;
                setError(null);
                setIsValid(true);
                return;
            }

            // Validate the Mermaid syntax
            await mermaid.parse(mermaidCode);

            // Generate unique ID for this diagram
            const id = `mermaid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

            // Render the diagram
            const { svg } = await mermaid.render(id, mermaidCode);
            renderRef.current.innerHTML = svg;

            setError(null);
            setIsValid(true);
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : "Invalid Mermaid syntax";
            setError(errorMessage);
            setIsValid(false);
            renderRef.current.innerHTML = `
                <div style="
                    padding: 16px; 
                    border: 2px dashed #ef4444; 
                    border-radius: 8px; 
                    background-color: #fef2f2; 
                    color: #dc2626;
                    font-family: monospace;
                    font-size: 14px;
                    margin: 16px;
                ">
                    <strong>Mermaid Syntax Error:</strong><br/>
                    ${errorMessage}
                </div>
            `;
        }
    };

    // Get current diagram content from node
    const getCurrentDiagram = useCallback(() => {
        return node.textContent || "";
    }, [node.textContent]);

    // Handle title changes
    const handleTitleChange = (newTitle: string) => {
        setTitle(newTitle);
        updateAttributes({ title: newTitle });
    };

    // Handle diagram type selection
    const handleTypeChange = (type: string) => {
        setSelectedType(type);
        const example = diagramExamples[type as keyof typeof diagramExamples] || "";
        
        // Replace the content in the editor
        const pos = getPos();
        editor.chain()
            .focus()
            .deleteRange({ from: pos, to: pos + node.nodeSize })
            .insertContentAt(pos, { 
                type: 'mermaid', 
                attrs: { title, layout, zoom },
                content: [{ type: 'text', text: example }]
            })
            .run();
    };




    // Global mouse move listener for dragging
    useEffect(() => {
        const handleGlobalMouseMove = (e: MouseEvent) => {
            if (!isDragging) return;
            
            e.preventDefault();
            const newPanPosition = {
                x: e.clientX - dragStart.x,
                y: e.clientY - dragStart.y
            };
            setPanPosition(newPanPosition);
        };

        const handleGlobalMouseUp = () => {
            setIsDragging(false);
        };

        if (isDragging) {
            document.addEventListener('mousemove', handleGlobalMouseMove);
            document.addEventListener('mouseup', handleGlobalMouseUp);
        }

        return () => {
            document.removeEventListener('mousemove', handleGlobalMouseMove);
            document.removeEventListener('mouseup', handleGlobalMouseUp);
        };
    }, [isDragging, dragStart]);

    // Listen for content changes and render diagram
    useEffect(() => {
        const currentDiagram = getCurrentDiagram();
        renderDiagram(currentDiagram);
    }, [getCurrentDiagram]);

    // Initial render
    useEffect(() => {
        const currentDiagram = getCurrentDiagram();
        renderDiagram(currentDiagram);
    }, [getCurrentDiagram]);


    return (
        <>
            <NodeViewWrapper 
                className={`mermaid-node-wrapper ${isActive ? 'active' : ''}`}
                ref={refs.setReference}
                {...getReferenceProps()}
            >
                <div 
                    ref={wrapperRef}
                    className="mermaid-editor-container"
                    onMouseDown={handleWrapperClick}
                >
                
                {/* Edit Mode: Show editor interface */}
                {editor.isEditable ? (
                    <div className={`mermaid-editor-layout ${layout === 'vertical' ? 'mermaid-editor-layout-vertical' : 'mermaid-editor-layout-horizontal'}`}>
                        {/* Left Panel: Edit Diagram */}
                        <div className="mermaid-editor-panel">
                            <div className="mermaid-panel-header">
                                <div className="mermaid-title-container">
                                    <input
                                        type="text"
                                        value={title}
                                        onChange={(e) => handleTitleChange(e.target.value)}
                                        placeholder="Diagram title (optional)"
                                        className="mermaid-title-field"
                                        maxLength={100}
                                    />
                                    <div className="mermaid-title-counter">
                                        {title.length}/100
                                    </div>
                                </div>
                                <StartWithMenu
                                    selectedType={selectedType}
                                    onTypeChange={handleTypeChange}
                                    diagramTypes={diagramTypes}
                                />
                            </div>

                            <div className="mermaid-code-editor">
                                <NodeViewContent 
                                    className="mermaid-code-content"
                                    placeholder="Enter your Mermaid diagram code here..."
                                />
                                {error && (
                                    <div className="mermaid-error-message">
                                        {error}
                                    </div>
                                )}
                            </div>

                            <div className="mermaid-footer">
                                <div className="mermaid-version" contentEditable={false}>
                                    Powered by Mermaid. Visit mermaid.live for the complete list of Mermaid syntax. Version: 11.10.1
                                </div>
                            </div>
                        </div>

                        {/* Right Panel: Diagram */}
                        <div className="mermaid-diagram-panel" contentEditable={false}>
                            <div className="mermaid-diagram-controls">
                                <button
                                    className={`mermaid-control-btn ${zoom <= 0.25 ? 'disabled' : ''}`}
                                    onClick={handleZoomOut}
                                    title="Zoom Out"
                                    disabled={zoom <= 0.25}
                                >
                                    <MdZoomOut />
                                </button>
                                <span className="mermaid-zoom-level">{Math.round(zoom * 100)}%</span>
                                <button
                                    className={`mermaid-control-btn ${zoom >= 3 ? 'disabled' : ''}`}
                                    onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        handleZoomIn();
                                    }}
                                    title="Zoom In"
                                    disabled={zoom >= 3}
                                >
                                    <MdZoomIn />
                                </button>
                            </div>
                            <div 
                                ref={renderRef}
                                className="mermaid-diagram-container"
                                style={{ 
                                    transform: `scale(${zoom}) translate(${panPosition.x}px, ${panPosition.y}px)`, 
                                    transformOrigin: 'center center',
                                    cursor: isDragging ? 'grabbing' : 'grab'
                                }}
                                onMouseDown={handleMouseDown}
                                onMouseMove={handleMouseMove}
                                onMouseUp={handleMouseUp}
                                onMouseLeave={handleMouseUp}
                            />
                        </div>
                    </div>
                ) : (
                    /* Non-Edit Mode: Show only the rendered diagram with title */
                    <div className="mermaid-display-mode">
                        {title && (
                            <h3 className="mermaid-display-title">{title}</h3>
                        )}
                        <div className="mermaid-display-container">
                            <div className="mermaid-diagram-controls">
                                <button
                                    className={`mermaid-control-btn ${zoom <= 0.25 ? 'disabled' : ''}`}
                                    onClick={handleZoomOut}
                                    title="Zoom Out"
                                    disabled={zoom <= 0.25}
                                >
                                    <MdZoomOut />
                                </button>
                                <span className="mermaid-zoom-level">{Math.round(zoom * 100)}%</span>
                                <button
                                    className={`mermaid-control-btn ${zoom >= 3 ? 'disabled' : ''}`}
                                    onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        handleZoomIn();
                                    }}
                                    title="Zoom In"
                                    disabled={zoom >= 3}
                                >
                                    <MdZoomIn />
                                </button>
                            </div>
                            <div 
                                ref={renderRef}
                                className="mermaid-display-diagram"
                                style={{ 
                                    transform: `scale(${zoom}) translate(${panPosition.x}px, ${panPosition.y}px)`, 
                                    transformOrigin: 'center center',
                                    cursor: isDragging ? 'grabbing' : 'grab'
                                }}
                                onMouseDown={handleMouseDown}
                                onMouseMove={handleMouseMove}
                                onMouseUp={handleMouseUp}
                                onMouseLeave={handleMouseUp}
                            />
                        </div>
                    </div>
                )}
            </div>
        </NodeViewWrapper>
        {(isOpen && editor.isEditable) && (
            <div ref={refs.setFloating} style={floatingStyles} {...getFloatingProps()} className="z-[9999]">
                <GenericFloatingOptions options={floatingOptions} />
            </div>
        )}
        </>
    );
};

export const MermaidNode = Node.create({
    name: "mermaid",
    group: "block",
    content: "inline*",
    defining: true,
    // atom: true,

    addAttributes() {
        return {
            title: {
                default: "",
            },
            layout: {
                default: "horizontal",
            },
            zoom: {
                default: 1,
            },
        };
    },

    parseHTML() {
        return [
            {
                tag: 'div[data-type="mermaid"]',
            },
        ];
    },

    renderHTML({ HTMLAttributes }) {
        return ["div", mergeAttributes(HTMLAttributes, { "data-type": "mermaid" }), 0];
    },

    addNodeView() {
        return ReactNodeViewRenderer(MermaidNodeComponent);
    },

    addKeyboardShortcuts() {
        return {
            "Mod-Shift-m": () => {
                return this.editor
                    .chain()
                    .insertContentAt(this.editor.state.selection.head, {
                        type: this.type.name,
                        attrs: { diagram: "", title: "" },
                    })
                    .focus()
                    .run();
            },
        };
    },
});
