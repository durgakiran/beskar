import { RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import tippy, { Instance } from "tippy.js";
import { createRoot } from "react-dom/client";
import useMutationObserver from "./useMutationObserver";

export const useTippyWrapperV2 = (ref: RefObject<HTMLElement>, elementId: string, content?: any, isEditable = false, additionalClasses?: string): void => {
    const instancesRef = useRef<Array<Instance> | undefined>();
    const [elementRendered, setElementRendered] = useState(false);

    const mutationObserverCallback = (mutations: MutationRecord[]) => {
        const element = document.querySelectorAll(`#${elementId.replace(/:/g, "\\:")}`);
        console.log(element);
        if (element.length) {
            setElementRendered(true);
        } else {
            setElementRendered(false);
        }
    };

    useMutationObserver(ref, mutationObserverCallback);

    useEffect(() => {
        console.log(ref, " element rendered ", elementRendered);
        if (elementRendered) {
            window.requestAnimationFrame(() => {
                if (!isEditable) {
                    return;
                }

                console.log(instancesRef.current);

                if (!content) {
                    return;
                }

                if (instancesRef.current) {
                    instancesRef.current?.every((i) => i.destroy());
                }

                instancesRef.current = tippy(document.querySelectorAll(`#${elementId.replace(/:/g, "\\:")}`), {
                    content: () => {
                        const wrapper = document.createElement("div");
                        const root = createRoot(wrapper);
                        root.render(content);
                        return wrapper;
                    },
                    trigger: "click",
                    interactive: true,
                    allowHTML: true,
                });

                if (additionalClasses && instancesRef.current) {
                    instancesRef.current?.forEach((i) => {
                        i.props.onShow = (i: Instance) => {
                            i.popper.classList.add(additionalClasses);
                        };
                    });
                }
            });
        }
        return () => {
            instancesRef.current?.every((i) => i.destroy());
        };
    }, [elementRendered]);

    useEffect(() => {
        if (instancesRef.current?.length) {
            instancesRef.current[0].setProps({
                content: () => {
                    const wrapper = document.createElement("div");
                    const root = createRoot(wrapper);
                    root.render(content);
                    return wrapper;
                },
            });
        }
    }, [content]);
};

export const useTippyWrapper = (elementId: string, content?: any, isEditable = false, additionalClasses?: string): void => {
    const instancesRef = useRef<Array<Instance> | undefined>();
    console.log(elementId);
    window.requestAnimationFrame(() => {
        console.log(elementId);
        if (!isEditable) {
            return;
        }

        if (!content || instancesRef.current?.length) {
            return;
        }

        console.log(instancesRef);

        instancesRef.current = tippy(document.querySelectorAll(`#${elementId.replace(/:/g, "\\:")}`), {
            content: () => {
                const wrapper = document.createElement("div");
                const root = createRoot(wrapper);
                root.render(content);
                return wrapper;
            },
            trigger: "click",
            interactive: true,
            allowHTML: true,
        });

        if (additionalClasses && instancesRef.current) {
            instancesRef.current?.forEach((i) => {
                i.props.onShow = (i: Instance) => {
                    i.popper.classList.add(additionalClasses);
                };
            });
        }
    });
    useEffect(
        () => () => {
            console.log(instancesRef.current);
            instancesRef.current?.every((i) => i.destroy());
        },
        [],
    );
};
