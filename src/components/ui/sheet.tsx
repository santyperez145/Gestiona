import * as React from 'react';
import * as Primitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DialogOverlay } from '@/components/ui/dialog';

export const Sheet = Primitive.Root;
export const SheetTrigger = Primitive.Trigger;
export const SheetClose = Primitive.Close;
export const SheetPortal = Primitive.Portal;
export const SheetOverlay = DialogOverlay;

export interface SheetContentProps extends Omit<React.ComponentPropsWithoutRef<typeof Primitive.Content>, 'title'> {
  side?: 'right' | 'left' | 'top' | 'bottom';
  title?: React.ReactNode;
  showHighlight?: boolean;
  showClose?: boolean;
  closeLabel?: string;
}
const sides = {
  right: 'inset-y-0 right-0 h-full w-full max-w-md border-l',
  left: 'inset-y-0 left-0 h-full w-full max-w-md border-r',
  top: 'inset-x-0 top-0 max-h-[90dvh] border-b',
  bottom: 'inset-x-0 bottom-0 max-h-[90dvh] border-t',
};
export const SheetContent = React.forwardRef<React.ElementRef<typeof Primitive.Content>, SheetContentProps>(
  ({ side = 'right', title, showClose = true, closeLabel = 'Cerrar', showHighlight: _showHighlight, children, className, ...props }, ref) => (
    <SheetPortal>
      <SheetOverlay />
      <Primitive.Content ref={ref} className={cn('fixed z-50 overflow-y-auto border-border bg-card p-6 text-card-foreground shadow-xl focus:outline-none', sides[side], className)} {...props}>
        {title && <SheetTitle className="mb-4 pr-10">{title}</SheetTitle>}
        {children}
        {showClose && <Primitive.Close aria-label={closeLabel} className="absolute right-3 top-3 inline-flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X className="h-4 w-4" /></Primitive.Close>}
      </Primitive.Content>
    </SheetPortal>
  ),
);
SheetContent.displayName = 'SheetContent';
export interface SheetHeaderProps extends React.HTMLAttributes<HTMLDivElement> { title?: string }
export function SheetHeader({ children, className, title, ...props }: SheetHeaderProps) {
  return <div className={cn('flex flex-col gap-2 pr-8', className)} {...props}>{title && <SheetTitle>{title}</SheetTitle>}{children}</div>;
}
export type SheetFooterProps = React.HTMLAttributes<HTMLDivElement>;
export function SheetFooter({ className, ...props }: SheetFooterProps) {
  return <div className={cn('mt-5 flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end', className)} {...props} />;
}
export const SheetTitle = React.forwardRef<React.ElementRef<typeof Primitive.Title>, React.ComponentPropsWithoutRef<typeof Primitive.Title>>(({ className, ...props }, ref) => <Primitive.Title ref={ref} className={cn('text-lg font-semibold', className)} {...props} />);
SheetTitle.displayName = 'SheetTitle';
export const SheetDescription = React.forwardRef<React.ElementRef<typeof Primitive.Description>, React.ComponentPropsWithoutRef<typeof Primitive.Description>>(({ className, ...props }, ref) => <Primitive.Description ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />);
SheetDescription.displayName = 'SheetDescription';
export default Sheet;
