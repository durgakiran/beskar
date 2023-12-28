import axios from "axios";

// post utility method
export const post = (path: string, body: any) => {
    return axios.post(path, body)
};

export const get = (path: string) => {
    return axios.get(path);
};

