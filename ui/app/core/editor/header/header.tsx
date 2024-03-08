'use client'
import FixedMenu from "@editor/fixedMenu/FixedMenu";

export function Editorheader({ handleClose }: { handleClose: () => void }) {
    return (
        <>
            <FixedMenu handleClose={handleClose} />
        </>
    )
}
