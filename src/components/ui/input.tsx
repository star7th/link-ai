import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-md border border-primary/20 dark:border-primary/30",
          "bg-light-input dark:bg-dark-input px-3 py-2 text-sm",
          "text-light-text-primary dark:text-dark-text-primary",
          "placeholder:text-light-text-tertiary dark:placeholder:text-dark-text-tertiary",
          "transition-all duration-200",
          "hover:border-primary/40 dark:hover:border-primary/40",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20",
          "focus-visible:border-primary focus-visible:shadow-[0_0_0_3px_rgba(99,102,241,0.12),0_0_8px_rgba(99,102,241,0.15)]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
