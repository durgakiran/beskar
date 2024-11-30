import { Avatar, Badge, Button, Table } from "flowbite-react";

type Props = {
    name: string;
    role: string;
    id: string;
};

export default function User(p: Props) {
    return (
        <div>
            <Avatar placeholderInitials={p.name.charAt(0).toUpperCase()} rounded>
                <div className="space-y-1 font-medium dark:text-white">{p.name}</div>
                <div className="text-sm text-gray-500 dark:text-gray-400">Joined in August 2014</div>
            </Avatar>
        </div>
    );
}
