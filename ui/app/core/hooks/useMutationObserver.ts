import { RefObject, useEffect } from "react";
import isClient from "./shared/isClient";
import isApiSupported from "./shared/isAPISupported";
import warnOnce from "./shared/warnOnce";

const errorMessage =
    "MutationObserver is not supported, this could happen both because window. MutationObserver is not supported by your current browser or you're using the useMutationObserver hook whilst server side rendering.";

const defaultOptions: MutationObserverInit = {
    attributes: true,
    characterData: true,
    childList: true,
    subtree: true,
};

export default function useMutationObserver<TElement extends HTMLElement>(ref: RefObject<TElement>, callback: MutationCallback, options: MutationObserverInit = defaultOptions) {
    const isSupported = isClient && isApiSupported("MutationObserver");

    if (!isSupported) {
        warnOnce(errorMessage);
        return;
    }

    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => {
        if (ref.current) {
            const observer = new MutationObserver(callback);
            // observer whole document to make sure we are observing elements from tippy
            observer.observe(document, options);

            return () => {
                observer.disconnect();
            };
        }
    }, [callback, options]);
}
