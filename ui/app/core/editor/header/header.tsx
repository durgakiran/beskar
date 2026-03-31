'use client'
import FixedMenu from "@editor/fixedMenu/FixedMenu";

export function Editorheader({ isEditorReady, handleClose, handleUpdate, isSidePanelOpen, setIsSidePanelOpen }: { isEditorReady: boolean, handleClose: () => void, handleUpdate: () => void, isSidePanelOpen: boolean, setIsSidePanelOpen: (open: boolean) => void }) {
    return (
        <>
            <FixedMenu isEditorReady={isEditorReady} handleClose={handleClose} handleUpdate={handleUpdate} isSidePanelOpen={isSidePanelOpen} setIsSidePanelOpen={setIsSidePanelOpen} />
        </>
    )
}
