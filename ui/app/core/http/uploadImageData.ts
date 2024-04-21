import { useEffect, useState } from "react";
import { post } from "./call";

const baseUrl = process.env.NEXT_PUBLIC_IMAGE_SERVER_URL;
const endpoint = "/media/upload";
export function uploadImageData(data: File): Promise<[string, number, number]> {
    const url = new Promise<[string, number, number]>((resolve, reject) => {
        const image = new Image();
        image.src = window.URL.createObjectURL(data);
        image.onload = function() {
            // upload image
            uploadImage(data).then((value) => {
                resolve([value.data.data.Name, image.width, image.height]);
            }).catch((err) => {
                reject(err);
            });
        }
    });
    

    return url;
}

function uploadImage(data: File) {
    const url = baseUrl + endpoint;
    const formData = new FormData();
    formData.append("file", data);
    return post(url, formData, { Accept: 'application/json' });
}


export function useLoadImage(src: string) {
    const [dataUrl, setDataUrl] = useState(null)
    useEffect(() => {
        const headers = new Headers();
        headers.set("Authorization", `Bearer ${localStorage.getItem("access_token")}`)
        const data = fetch(src, { headers });
        data.then((res) => {
            res.blob().then((value) => {
                const image = URL.createObjectURL(value);
                setDataUrl(image);
            });
        })
    }, [src]);

    return dataUrl;
}

