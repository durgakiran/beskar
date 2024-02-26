import { icons } from "lucide-react";

export type ContentTypePickerOption = {
    label: string;
    id: string;
    disabled: () => boolean;
    isActive: () => boolean;
    onClick: () => void;
    icon: keyof typeof icons;
}
