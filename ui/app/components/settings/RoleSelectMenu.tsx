"use client";

import { Select } from "@radix-ui/themes";

const roles = ["admin", "editor", "commenter", "viewer"] as const;

export default function RoleSelectMenu({
    value,
    disabled,
    onChange,
}: {
    value: string;
    disabled?: boolean;
    onChange: (role: string) => void;
}) {
    return (
        <Select.Root value={value} disabled={disabled} onValueChange={onChange}>
            <Select.Trigger className="min-w-[120px]" />
            <Select.Content>
                {roles.map((role) => (
                    <Select.Item key={role} value={role}>
                        {role}
                    </Select.Item>
                ))}
            </Select.Content>
        </Select.Root>
    );
}
