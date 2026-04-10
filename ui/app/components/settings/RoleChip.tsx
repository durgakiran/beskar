type UserRole = "owner" | "admin" | "editor" | "commenter" | "viewer";

const roleClassMap: Record<UserRole, string> = {
    owner: "bg-primary-100 text-primary-800 border-primary-200",
    admin: "bg-sky-100 text-sky-800 border-sky-200",
    editor: "bg-mauve-100 text-mauve-800 border-mauve-200",
    commenter: "bg-amber-100 text-amber-800 border-amber-200",
    viewer: "bg-neutral-100 text-neutral-700 border-neutral-200",
};

export default function RoleChip({ role }: { role: UserRole }) {
    return (
        <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${roleClassMap[role]}`}>
            {role}
        </span>
    );
}
