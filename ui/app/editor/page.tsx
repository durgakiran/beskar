'use client'
import TipTap from "@components/tiptap";
// import { useQuill } from "@editor"
// import { useEffect } from "react";

const options = {}

export default function Page() {
    // const [quillObj, onRefChange] = useQuill(options);

    // useEffect(() => {
    //     console.log(quillObj);
    // }, [quillObj])

    return (
        <div style={{ width: 500, height: 300 }}>
            {/* <div ref={onRefChange} ></div> */}
            <TipTap />
        </div>
    )
}
