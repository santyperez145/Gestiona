import { useState, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const PRESET_COLORS = [
  "#D4A843", "#E74C3C", "#3498DB", "#2ECC71", "#9B59B6",
  "#F39C12", "#1ABC9C", "#E91E63", "#FF5722", "#607D8B",
  "#1A1A2E", "#0F0F23", "#1E293B", "#1C1917", "#18181B",
  "#27272A", "#292524", "#1E3A5F", "#2D1B69", "#1B4332",
];

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  label: string;
}

export function ColorPicker({ value, onChange, label }: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const nativeRef = useRef<HTMLInputElement>(null);

  return (
    <div>
      <label className="text-sm text-muted-foreground">{label}</label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button className="flex items-center gap-2 mt-1 w-full px-3 py-2 bg-muted border border-border rounded-lg hover:border-primary/50 transition-colors">
            <div
              className="w-8 h-8 rounded-md border border-border shadow-inner flex-shrink-0"
              style={{ backgroundColor: value }}
            />
            <span className="text-sm font-mono text-foreground">{value.toUpperCase()}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3 space-y-3" align="start">
          <div className="grid grid-cols-5 gap-2">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => { onChange(c); }}
                className={cn(
                  "w-9 h-9 rounded-md border-2 transition-all hover:scale-110",
                  value.toLowerCase() === c.toLowerCase()
                    ? "border-primary ring-2 ring-primary/30 scale-110"
                    : "border-border"
                )}
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <div
              className="w-10 h-10 rounded-md border border-border cursor-pointer flex-shrink-0 relative overflow-hidden"
              style={{ backgroundColor: value }}
              onClick={() => nativeRef.current?.click()}
            >
              <input
                ref={nativeRef}
                type="color"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
              />
            </div>
            <Input
              value={value}
              onChange={(e) => {
                const v = e.target.value;
                if (/^#[0-9A-Fa-f]{0,6}$/.test(v)) onChange(v);
              }}
              className="bg-muted border-border font-mono text-sm flex-1"
              maxLength={7}
              placeholder="#000000"
            />
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
