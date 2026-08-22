import * as React from "react";

import { cn } from "@/lib/utils";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[96px] w-full rounded-[9px] border border-border/85",
        "bg-card/90 px-3 py-2.5 text-[13px] text-foreground",
        "placeholder:text-muted-foreground/55 resize-vertical",
        "transition-[border-color,box-shadow] duration-150",
        "hover:border-primary/25 focus-visible:outline-none focus-visible:border-primary/55",
        "focus-visible:shadow-[0_0_0_3px_hsl(var(--primary)/0.1)]",
        "disabled:cursor-not-allowed disabled:opacity-40",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
