import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border text-sm font-medium " +
    "transition-all duration-150 ease-out " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background " +
    "disabled:pointer-events-none disabled:opacity-40 " +
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-gradient-to-b from-primary to-primary/[0.92] text-primary-foreground font-semibold border-primary/40 shadow-[0_1px_2px_hsl(var(--primary)/0.25),0_4px_10px_-4px_hsl(var(--primary)/0.45)] hover:shadow-[0_1px_2px_hsl(var(--primary)/0.30),0_6px_14px_-4px_hsl(var(--primary)/0.55)] hover:-translate-y-[0.5px]",

        destructive:
          "bg-destructive text-destructive-foreground border-destructive/40 hover:bg-destructive/90",

        outline:
          "border-border/80 bg-background/50 text-foreground/85 backdrop-blur-sm hover:border-primary/40 hover:bg-primary/[0.04] hover:text-foreground",

        secondary:
          "border-border/55 bg-secondary/80 text-secondary-foreground hover:bg-secondary",

        ghost:
          "text-foreground/70 hover:bg-muted/60 hover:text-foreground",

        link:
          "text-primary underline-offset-4 hover:underline h-auto p-0",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm:      "h-8 rounded-md px-3 text-[13px]",
        lg:      "h-11 rounded-md px-6 text-[15px]",
        xs:      "h-6 rounded-md px-2 text-[11px] gap-1",
        icon:    "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size:    "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
