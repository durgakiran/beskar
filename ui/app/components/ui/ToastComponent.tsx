import ModifiedIcon from "@components/modifiedIcon";
import { Toast } from "flowbite-react";

interface props {
    icon: string;
    type: "success" | "error" | "warning";
    toggle: boolean;
    message: string;
}

export default function ToastComponent(props: props) {
    const successClasses = "bg-green-100 text-green-500 dark:bg-green-800 dark:text-green-200";
    const warningClasses = "bg-orange-100 text-orange-500 dark:bg-orange-700 dark:text-orange-200";
    const errorClasses = "bg-red-100 text-red-500 dark:bg-red-800 dark:text-red-200";

    return (
        <Toast className="fixed bottom-5 right-5" duration={75}>
            <div
                className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${props.type === "success" ? successClasses : props.type === "error" ? errorClasses : warningClasses}`}
            >
                <ModifiedIcon name={props.icon} size={16} />
            </div>
            <div className="ml-3 text-sm font-normal">{props.message}</div>
            {props.toggle ? <Toast.Toggle /> : null}
        </Toast>
    );

}
