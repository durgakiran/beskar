import { icons } from "lucide-react"
import { memo } from "react";

const ModifiedIcon = ({name, size}: { name: string, size: number }) => {
    const IconComponent = icons[name];

    if (!IconComponent) {
        return null;
    }

    return <IconComponent  size={size} />
}

export default memo(ModifiedIcon);
