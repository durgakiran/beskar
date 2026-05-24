interface ContextMenuProps {
    position: {
        x: number;
        y: number;
    } | null;
    onClose: () => void;
}
export declare function ContextMenu({ position, onClose }: ContextMenuProps): import("react/jsx-runtime").JSX.Element | null;
export {};
