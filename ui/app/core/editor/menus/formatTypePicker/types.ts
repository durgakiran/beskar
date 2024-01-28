import { icons } from "lucide-react";

export type FormatTypePickerOption = {
    label: string;
    id: string;
    disabled: () => boolean;
    isActive: () => boolean;
    onClick: () => void;
    icon: keyof typeof icons;
}
