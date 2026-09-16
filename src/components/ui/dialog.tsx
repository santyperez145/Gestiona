import * as React from 'react';
import * as Primitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

const Dialog = Primitive.Root;
const DialogTrigger = Primitive.Trigger;
const DialogClose = Primitive.Close;
const DialogPortal = Primitive.Portal;

const DialogOverlay = React.forwardRef<React.ElementRef<typeof Primitive.Overlay>, React.ComponentPropsWithoutRef<typeof Primitive.Overlay>>(({ className, ...props }, ref) => (
  <Primitive.Overlay ref={ref} className={cn('fixed inset-0 z-50 bg-black/45 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0', className)} {...props} />
));
DialogOverlay.displayName = 'DialogOverlay';

const sizes = { sm: 'max-w-sm', default: 'max-w-lg', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl', full: 'max-w-none' };
interface DialogContentProps extends React.ComponentPropsWithoutRef<typeof Primitive.Content> {
  size?: keyof typeof sizes;
  hideClose?: boolean;
  overlayClassName?: string;
}

const DialogContent = React.forwardRef<React.ElementRef<typeof Primitive.Content>, DialogContentProps>(
  ({ className, children, size = 'default', hideClose = false, overlayClassName, ...props }, ref) => (
    <DialogPortal>
      <DialogOverlay className={overlayClassName} />
      <Primitive.Content ref={ref} className={cn(
        'fixed left-1/2 top-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg border border-border bg-card p-6 text-card-foreground shadow-xl focus:outline-none',
        sizes[size], className,
      )} {...props}>
        {children}
        {!hideClose && <Primitive.Close className="absolute right-3 top-3 inline-flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Cerrar"><X className="h-4 w-4" /></Primitive.Close>}
      </Primitive.Content>
    </DialogPortal>
  ),
);
DialogContent.displayName = 'DialogContent';

function DialogHeader({ className, children, title, description, ...props }: React.HTMLAttributes<HTMLDivElement> & { description?: string }) {
  return <div className={cn('flex flex-col gap-1 pr-8', className)} {...props}>{title && <DialogTitle>{title}</DialogTitle>}{description && <DialogDescription>{description}</DialogDescription>}{children}</div>;
}
function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col-reverse gap-2 pt-4 sm:flex-row sm:justify-end', className)} {...props} />;
}
const DialogTitle = React.forwardRef<React.ElementRef<typeof Primitive.Title>, React.ComponentPropsWithoutRef<typeof Primitive.Title>>(({ className, ...props }, ref) => <Primitive.Title ref={ref} className={cn('text-lg font-semibold text-foreground', className)} {...props} />);
DialogTitle.displayName = 'DialogTitle';
const DialogDescription = React.forwardRef<React.ElementRef<typeof Primitive.Description>, React.ComponentPropsWithoutRef<typeof Primitive.Description>>(({ className, ...props }, ref) => <Primitive.Description ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />);
DialogDescription.displayName = 'DialogDescription';

export { Dialog, DialogTrigger, DialogClose, DialogPortal, DialogOverlay, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription };
export default Dialog;
