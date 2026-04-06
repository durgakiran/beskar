import { icons } from "lucide-react";
import { ReactNode } from "react";

export type PrimitiveIconName = keyof typeof icons;

export type NavItem = {
    id: string;
    label: string;
    href?: string;
    active?: boolean;
};

export type TopbarMenuItem = {
    id: string;
    label: string;
    icon: PrimitiveIconName;
    href?: string;
    onSelect?: () => void;
    tone?: "default" | "danger";
};

export type TopbarUser = {
    name: string;
    email: string;
    initials: string;
};

export type TopbarProps = {
    brand: string;
    brandHref?: string;
    navItems?: NavItem[];
    user?: TopbarUser;
    userMenuItems?: TopbarMenuItem[];
    notificationOpen?: boolean;
    onNotificationsClick?: () => void;
    notificationSlot?: ReactNode;
    userSlot?: ReactNode;
    className?: string;
};

export type SidebarPageItemProps = {
    id: string;
    title: string;
    href?: string;
    type?: "document" | "whiteboard";
    active?: boolean;
    depth?: number;
    expanded?: boolean;
    hasChildren?: boolean;
    onToggle?: (id: string) => void;
    onAddChild?: (id: string) => void;
    onSelect?: (id: string) => void;
    className?: string;
};

export type PageTreeNode = {
    id: string;
    title: string;
    href?: string;
    type?: "document" | "whiteboard";
    children?: PageTreeNode[];
};

export type PageTreeProps = {
    nodes: PageTreeNode[];
    expandedIds?: string[];
    activeId?: string;
    onToggle?: (id: string) => void;
    onAddChild?: (id: string) => void;
    onSelect?: (id: string) => void;
    className?: string;
};

export type UserRole = "owner" | "admin" | "editor" | "commenter" | "viewer";

export type UserRowData = {
    id: string;
    name: string;
    email: string;
    role: UserRole;
    avatarFallback?: string;
};

export type UserTableRowProps = {
    user: UserRowData;
    actionSlot?: ReactNode;
    className?: string;
    compact?: boolean;
};

export type SpacesHeaderProps = {
    title: string;
    subtitle: string;
    actionLabel?: string;
    onAction?: () => void;
    actionSlot?: ReactNode;
    className?: string;
};

export type SpaceCardProps = {
    title: string;
    description: string;
    badge?: string;
    badges?: string[];
    meta: string;
    leadingLabel?: string;
    href?: string;
    onClick?: () => void;
    className?: string;
};

export type CreateSpaceModalProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    value: string;
    onValueChange: (value: string) => void;
    descriptionValue?: string;
    onDescriptionChange?: (value: string) => void;
    onSubmit: () => void;
    loading?: boolean;
    title?: string;
    description?: string;
    label?: string;
    placeholder?: string;
    descriptionLabel?: string;
    descriptionPlaceholder?: string;
    submitLabel?: string;
    cancelLabel?: string;
    errorMessage?: string;
};

export type NoticeTone = "success" | "warning" | "error" | "info";

export type StatusNoticeProps = {
    tone: NoticeTone;
    message: string;
    title?: string;
    onDismiss?: () => void;
    actionLabel?: string;
    onAction?: () => void;
    className?: string;
};

export type ModalScrimProps = {
    children?: ReactNode;
    className?: string;
};

export type SpaceSummaryStatProps = {
    label: string;
    value: number | string;
    className?: string;
};

export type InlineEditableProps = {
    value: string;
    onSave: (newValue: string) => void;
    placeholder?: string;
    multiline?: boolean;
    canEdit?: boolean;
    isLoading?: boolean;
    className?: string;
    textClassName?: string;
    inputClassName?: string;
};
