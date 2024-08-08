export { useGet } from "./useGet";
export { usePost } from "./usePost";

export interface Response<T> {
    data: T;
    status: string;
}
