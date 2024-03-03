import { post } from "./call";

const baseUrl = process.env.NEXT_PUBLIC_IMAGE_SERVER_URL;
const endpoint = "/media";
export function uploadImageData(data: File): Promise<string> {
    const url = new Promise<string>((resolve, reject) => {
        const image = new Image();
        image.src = window.URL.createObjectURL(data);
        image.onload = function() {
            // upload image
            uploadImage(data).then((value) => {
                console.log(value);
                console.log(value.data.data.name);
                resolve(value.data.data.name);
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
