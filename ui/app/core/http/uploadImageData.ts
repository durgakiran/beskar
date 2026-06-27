import { useEffect, useState } from "react";
import { post } from "./call";
import { getApiV1Base } from "./apiBase";
import { extractRequestErrorMessage } from "./errorMessage";

export function uploadImageData(data: File, pageId: number): Promise<[string, number, number]> {
    const url = new Promise<[string, number, number]>((resolve, reject) => {
        const image = new Image();
        image.src = window.URL.createObjectURL(data);
        image.onload = function () {
            // upload image
            uploadImage(data, pageId)
                .then((value) => {
                    resolve([value.data.data.Name, image.width, image.height]);
                })
                .catch((err) => {
                    reject(err);
                });
        };
        image.onerror = function () {
            reject(new Error("Unable to read image"));
        };
    });

    return url;
}

async function uploadImage(data: File, pageId: number) {
    const apiV1 = getApiV1Base({ fallbackBase: import.meta.env.VITE_IMAGE_SERVER_URL });
    const url = `${apiV1}/media/upload`;
    const formData = new FormData();
    formData.append("file", data);
    formData.append("pageId", String(pageId));
    try {
        return await post(url, formData, { Accept: "application/json" });
    } catch (error) {
        throw new Error(extractRequestErrorMessage(error, "Upload failed"));
    }
}

export function useLoadImage(src: string) {
    const [dataUrl, setDataUrl] = useState(null);
    useEffect(() => {
        const headers = new Headers();
        headers.set("Authorization", `Bearer ${localStorage.getItem("access_token")}`);
        const data = fetch(src, { headers });
        data.then((res) => {
            res.blob().then((value) => {
                const image = URL.createObjectURL(value);
                setDataUrl(image);
            });
        });
    }, [src]);

    return dataUrl;
}
