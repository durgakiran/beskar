'use client'
import FixedMenu from "@editor/fixedMenu/FixedMenu";

export function Editorheader({ handleClose, handleUpdate }: { handleClose: () => void, handleUpdate: () => void }) {
    return (
        <>
            <FixedMenu handleClose={handleClose} handleUpdate={handleUpdate} />
        </>
    )
}
