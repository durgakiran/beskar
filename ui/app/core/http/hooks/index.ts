export { useGet } from "./useGet";
export { usePost } from "./usePost";
export { useDelete } from "./useDelete";

export interface Response<T> {
    data: T;
    status: string;
}
