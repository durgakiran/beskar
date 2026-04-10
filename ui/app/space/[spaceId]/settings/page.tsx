import { redirect } from "next/navigation";

export default async function Page({ params }: { params: Promise<{ spaceId: string }> }) {
    const { spaceId } = await params;
    redirect(`/space/${spaceId}/settings/users`);
}
