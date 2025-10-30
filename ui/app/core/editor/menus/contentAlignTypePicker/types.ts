import { icons } from "lucide-react";

export type ContentAlignTypePickerOption = {
    label: string;
    id: string;
    disabled: () => boolean | undefined;
    isActive: () => boolean;
    onClick: () => void;
    icon: keyof typeof icons;
}
