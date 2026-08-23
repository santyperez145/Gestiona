import { useRef, useState, type RefObject } from "react";
import { FileUp, Loader2, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { fileMatchesAccept } from "@/lib/filePicker";
import { cn } from "@/lib/utils";

interface FilePickerProps {
  accept: string;
  onFile: (file: File) => void | Promise<void>;
  title: string;
  description?: string;
  mode?: "button" | "dropzone";
  icon?: LucideIcon;
  disabled?: boolean;
  busy?: boolean;
  busyLabel?: string;
  className?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
}

export default function FilePicker({
  accept,
  onFile,
  title,
  description,
  mode = "dropzone",
  icon: Icon = FileUp,
  disabled = false,
  busy = false,
  busyLabel = "Procesando archivo…",
  className,
  inputRef: externalInputRef,
}: FilePickerProps) {
  const fallbackInputRef = useRef<HTMLInputElement>(null);
  const inputRef = externalInputRef ?? fallbackInputRef;
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const unavailable = disabled || busy;

  const selectFile = (file?: File) => {
    if (!file || unavailable) return;
    if (!fileMatchesAccept(file, accept)) {
      setError(`Formato no admitido. Usá ${accept}.`);
      return;
    }
    setError("");
    void onFile(file);
  };

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept={accept}
      className="sr-only"
      tabIndex={-1}
      disabled={unavailable}
      onChange={event => {
        const file = event.target.files?.[0];
        event.target.value = "";
        selectFile(file);
      }}
    />
  );

  if (mode === "button") {
    return (
      <span className={cn("inline-flex flex-col items-start", className)}>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={unavailable}
          aria-busy={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Icon className="mr-2 h-4 w-4" />}
          {busy ? busyLabel : title}
        </Button>
        {input}
        {error && <span role="alert" className="mt-1 text-xs text-destructive">{error}</span>}
      </span>
    );
  }

  return (
    <div className={className}>
      <button
        type="button"
        className={cn(
          "group flex min-h-32 w-full flex-col items-center justify-center rounded-[12px] border border-dashed px-6 py-7 text-center transition-[border-color,background-color,box-shadow]",
          "border-primary/25 bg-primary/[0.025] hover:border-primary/50 hover:bg-primary/[0.055]",
          "focus-visible:outline-none focus-visible:border-primary/60 focus-visible:shadow-[0_0_0_3px_hsl(var(--primary)/0.1)]",
          dragging && "border-primary/70 bg-primary/[0.08] shadow-[0_0_0_3px_hsl(var(--primary)/0.08)]",
          unavailable && "cursor-not-allowed opacity-50",
        )}
        disabled={unavailable}
        aria-busy={busy}
        onClick={() => inputRef.current?.click()}
        onDragEnter={event => { event.preventDefault(); if (!unavailable) setDragging(true); }}
        onDragOver={event => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={event => {
          event.preventDefault();
          setDragging(false);
          selectFile(event.dataTransfer.files?.[0]);
        }}
      >
        <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-[10px] bg-primary/10 text-primary transition-transform group-hover:-translate-y-0.5">
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Icon className="h-5 w-5" />}
        </span>
        <span className="text-sm font-semibold text-foreground">{busy ? busyLabel : title}</span>
        {description && <span className="mt-1 max-w-md text-xs text-muted-foreground">{description}</span>}
      </button>
      {input}
      {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}
