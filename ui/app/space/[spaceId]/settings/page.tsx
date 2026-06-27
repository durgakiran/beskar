import { redirect } from "next/navigation";

export default function Page() {
    const { spaceId } = await params;
    redirect(`/space/${spaceId}/settings/users`);
}
