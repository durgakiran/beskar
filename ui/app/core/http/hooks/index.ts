export { useGet } from "./useGet";
export { usePost } from "./usePost";
export { usePUT, usePut } from "./usePut";
export { useDelete } from "./useDelete";

export interface Response<T> {
    data: T;
    status: string;
}
