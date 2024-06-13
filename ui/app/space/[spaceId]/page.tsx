'use client'
export default function Page({ params }: { params: { spaceId: string } }) {
    return (
        <div>You are viewing spaceId: {params.spaceId}</div>
    )
}
