import { cn } from "@/lib/utils";
import React from "react";

export type ButtonVariant = "primary" | "secondary" | "tertiary" | "quaternary" | "ghost";
export type ButtonSize = "medium" | "small" | "icon" | "iconSmall";

export type ButtonProps = {
    variant?: ButtonVariant;
    active?: boolean;
    activeClassname?: string;
    buttonSize?: ButtonSize;
} & React.ButtonHTMLAttributes<HTMLButtonElement>;

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ active, buttonSize = "medium", children, disabled, variant = "primary", className, activeClassname, ...rest }, ref) => {
    const buttonClassName = cn(
        "flex group items-center justify-center border border-transparent gap-2 text-sm font-semibold rounded-md disabled:opacity-50 whitespace-nowrap",

        variant === "primary" &&
            cn(
                "text-white bg-primary-700 border-primary-700",
                !disabled && !active && "hover:bg-primary-800 active:bg-primary-900",
                active && cn("bg-primary-900 border-primary-900", activeClassname),
            ),

        variant === "secondary" &&
            cn(
                "border-neutral-400 bg-white text-neutral-900",
                !disabled && !active && "hover:bg-neutral-100 active:bg-neutral-200",
                active && "bg-neutral-200",
            ),

        variant === "tertiary" &&
            cn(
                "border-transparent bg-neutral-50 text-neutral-900",
                !disabled && !active && "hover:bg-neutral-100 active:bg-neutral-200",
                active && cn("bg-neutral-200", activeClassname),
            ),

        variant === "ghost" &&
            cn(
                "bg-transparent border-transparent text-neutral-500",
                !disabled &&
                    !active &&
                    "hover:bg-primary-50 hover:text-primary-700 active:bg-primary-100 active:text-primary-800",
                active && cn("bg-primary-100 text-primary-800", activeClassname),
            ),

        buttonSize === "medium" && "py-2 px-3",
        buttonSize === "small" && "py-1 px-2",
        buttonSize === "icon" && "w-8 h-8",
        buttonSize === "iconSmall" && "w-6 h-6",

        className,
    );

    return (
        <button ref={ref} disabled={disabled} className={buttonClassName} {...rest}>
            {children}
        </button>
    );
});

Button.displayName = "Button";
