import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  // Distinctive shimmer instead of generic pulse — uses gradient animation
  return (
    <div
      className={cn(
        "relative rounded-[6px] overflow-hidden",
        "bg-[hsl(228_22%_9%)]",
        "before:absolute before:inset-0",
        "before:bg-gradient-to-r before:from-transparent before:via-[hsl(228_20%_14%/0.6)] before:to-transparent",
        "before:animate-shimmer before:bg-[length:200%_100%]",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
