import axios from "axios";

// post utility method
export const post = (path: string, body: any, headerOptions: Record<string, any>) => {
    return axios.post(path, body, {
        withCredentials: false,
        headers: { Authorization: `Bearer ${localStorage.getItem("access_token")}`, ...headerOptions },
    });
};

export const get = (path: string, headers: Record<string, any> = {}) => {
    return axios.get(path, { withCredentials: false, headers: { Authorization: `Bearer ${localStorage.getItem("access_token")}`, ...headers } });
};
