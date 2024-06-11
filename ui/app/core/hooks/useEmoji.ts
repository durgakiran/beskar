import { useEffect, useState } from "react";
import data from '@emoji-mart/data'
import { init, SearchIndex } from 'emoji-mart'

init({ data })


export default function useEmoji() {
    const [emojiSearchString, setEmojiSearchString] = useState();

    useEffect(() => {
        if (emojiSearchString) {
            
        }

    }, [emojiSearchString]);

    return [setEmojiSearchString];
}
