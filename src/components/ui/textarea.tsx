import * as React from "react";

import { cn } from "@/lib/utils";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[80px] w-full rounded-[7px] border border-border/55",
        "bg-[hsl(228_26%_5.5%)] px-3 py-2 text-[13px] text-foreground",
        "placeholder:text-muted-foreground/40 resize-vertical",
        "transition-[border-color,box-shadow] duration-150",
        "focus-visible:outline-none focus-visible:border-primary/45",
        "focus-visible:shadow-[0_0_0_3px_hsl(38_82%_52%/0.08),inset_0_0_0_1px_hsl(38_82%_52%/0.12)]",
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
