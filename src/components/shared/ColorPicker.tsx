import { useState, useRef, useCallback, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Copy, Check } from "lucide-react";

// ─── Color math ───────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').padEnd(6, '0');
  return [
    parseInt(clean.slice(0, 2), 16) || 0,
    parseInt(clean.slice(2, 4), 16) || 0,
    parseInt(clean.slice(4, 6), 16) || 0,
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b]
    .map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
    .join('');
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;
  if (d !== 0) {
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return [h * 360, s, v];
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const hh = ((h % 360) + 360) % 360 / 60;
  const i = Math.floor(hh);
  const f = hh - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const variants: [number, number, number][] = [
    [v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q],
  ];
  const [r, g, b] = variants[i % 6];
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

// ─── Preset swatches (8 × 4 = 32 colors) ─────────────────────────────────────

const PRESET_SWATCHES = [
  // Warm: golds, ambers, oranges, reds
  '#D4A843', '#F59E0B', '#E97316', '#EF4444',
  '#DC143C', '#EC4899', '#A855F7', '#8B5CF6',
  // Cool: blues, cyans, teals, greens
  '#6366F1', '#3B82F6', '#06B6D4', '#10B981',
  '#22C55E', '#84CC16', '#EAB308', '#FB923C',
  // Dark backgrounds
  '#0E0E1C', '#1A1A2E', '#0F172A', '#1E1B4B',
  '#18181B', '#111827', '#0C0A09', '#1C1917',
  // Rich tones
  '#FF6B6B', '#FF8E53', '#6BCB77', '#4D96FF',
  '#C77DFF', '#FF9671', '#845EC2', '#FFD93D',
];

// ─── Component ────────────────────────────────────────────────────────────────

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  label: string;
}

export function ColorPicker({ value, onChange, label }: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // HSV state (authoritative while picker is open)
  const [hue, setHue] = useState(0);
  const [sat, setSat] = useState(1);
  const [bri, setBri] = useState(1);

  // Text inputs
  const [hexInput, setHexInput] = useState(value.toUpperCase());
  const [rInput, setRInput] = useState('0');
  const [gInput, setGInput] = useState('0');
  const [bInput, setBInput] = useState('0');

  const gradRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<'gradient' | 'hue' | null>(null);

  // Sync from `value` prop → HSV + text inputs when popover opens or value changes externally
  useEffect(() => {
    const hex = value && /^#[0-9A-Fa-f]{6}$/.test(value) ? value : '#000000';
    const [r, g, b] = hexToRgb(hex);
    const [h, s, v] = rgbToHsv(r, g, b);
    setHue(h); setSat(s); setBri(v);
    setHexInput(hex.toUpperCase());
    setRInput(String(r)); setGInput(String(g)); setBInput(String(b));
  }, [value, open]);

  // Commit HSV → hex → parent
  const commitHsv = useCallback((h: number, s: number, v: number) => {
    const [r, g, b] = hsvToRgb(h, s, v);
    const hex = rgbToHex(r, g, b);
    setHexInput(hex.toUpperCase());
    setRInput(String(r)); setGInput(String(g)); setBInput(String(b));
    onChange(hex);
  }, [onChange]);

  // Gradient pointer handlers
  const readGradient = useCallback((e: React.PointerEvent | PointerEvent) => {
    if (!gradRef.current) return;
    const rect = gradRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    setSat(x); setBri(1 - y);
    commitHsv(hue, x, 1 - y);
  }, [hue, commitHsv]);

  // Hue bar pointer handlers
  const readHue = useCallback((e: React.PointerEvent | PointerEvent) => {
    if (!hueRef.current) return;
    const rect = hueRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const newHue = x * 360;
    setHue(newHue);
    commitHsv(newHue, sat, bri);
  }, [sat, bri, commitHsv]);

  // HEX text input
  const handleHexInput = (raw: string) => {
    const v = raw.toUpperCase();
    setHexInput(v.startsWith('#') ? v : '#' + v);
    const full = v.startsWith('#') ? v : '#' + v;
    if (/^#[0-9A-F]{6}$/.test(full)) {
      const [r, g, b] = hexToRgb(full);
      const [h, s, br] = rgbToHsv(r, g, b);
      setHue(h); setSat(s); setBri(br);
      setRInput(String(r)); setGInput(String(g)); setBInput(String(b));
      onChange(full.toLowerCase());
    }
  };

  // RGB channel input
  const handleRgbInput = (ch: 'r' | 'g' | 'b', raw: string) => {
    const num = Math.max(0, Math.min(255, parseInt(raw) || 0));
    if (ch === 'r') setRInput(raw);
    if (ch === 'g') setGInput(raw);
    if (ch === 'b') setBInput(raw);
    const r = ch === 'r' ? num : (parseInt(rInput) || 0);
    const g = ch === 'g' ? num : (parseInt(gInput) || 0);
    const b = ch === 'b' ? num : (parseInt(bInput) || 0);
    const hex = rgbToHex(r, g, b);
    const [h, s, v] = rgbToHsv(r, g, b);
    setHue(h); setSat(s); setBri(v);
    setHexInput(hex.toUpperCase());
    onChange(hex);
  };

  // Apply a preset swatch
  const applyPreset = (c: string) => {
    onChange(c);
    const [r, g, b] = hexToRgb(c);
    const [h, s, v] = rgbToHsv(r, g, b);
    setHue(h); setSat(s); setBri(v);
    setHexInput(c.toUpperCase());
    setRInput(String(r)); setGInput(String(g)); setBInput(String(b));
  };

  const copy = () => {
    navigator.clipboard.writeText(value.toUpperCase()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  // Computed display values
  const [dr, dg, db] = hsvToRgb(hue, sat, bri);
  const displayHex = rgbToHex(dr, dg, db);
  const hueCssColor = `hsl(${hue.toFixed(1)}, 100%, 50%)`;

  return (
    <div>
      <label className="text-sm text-muted-foreground">{label}</label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button className="flex items-center gap-2.5 mt-1 w-full px-3 py-2 bg-muted border border-border rounded-lg hover:border-primary/50 transition-colors text-left">
            <div
              className="w-9 h-9 rounded-lg border border-border/60 shadow-inner flex-shrink-0"
              style={{ backgroundColor: value }}
            />
            <div className="min-w-0">
              <p className="text-sm font-mono text-foreground leading-tight">{value.toUpperCase()}</p>
              <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                RGB({hexToRgb(value && /^#[0-9A-Fa-f]{6}$/.test(value) ? value : '#000').join(', ')})
              </p>
            </div>
          </button>
        </PopoverTrigger>

        <PopoverContent className="w-[308px] p-3 space-y-3" align="start" side="bottom">
          {/* ── Gradient square ──────────────────────────────────── */}
          <div
            ref={gradRef}
            className="relative w-full rounded-xl overflow-hidden cursor-crosshair select-none"
            style={{
              height: '160px',
              background: `
                linear-gradient(to bottom, transparent 0%, #000 100%),
                linear-gradient(to right, #fff 0%, ${hueCssColor} 100%)
              `,
              touchAction: 'none',
            }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              dragging.current = 'gradient';
              readGradient(e);
            }}
            onPointerMove={(e) => { if (dragging.current === 'gradient') readGradient(e); }}
            onPointerUp={() => { dragging.current = null; }}
          >
            {/* Cursor dot */}
            <div
              className="absolute w-4 h-4 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none"
              style={{
                left: `${sat * 100}%`,
                top: `${(1 - bri) * 100}%`,
                backgroundColor: displayHex,
                boxShadow: '0 0 0 2px white, 0 0 0 3px rgba(0,0,0,0.4), 0 2px 6px rgba(0,0,0,0.5)',
              }}
            />
          </div>

          {/* ── Hue bar ─────────────────────────────────────────── */}
          <div
            ref={hueRef}
            className="relative w-full h-5 rounded-lg overflow-hidden cursor-pointer select-none"
            style={{
              background: 'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)',
              touchAction: 'none',
            }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              dragging.current = 'hue';
              readHue(e);
            }}
            onPointerMove={(e) => { if (dragging.current === 'hue') readHue(e); }}
            onPointerUp={() => { dragging.current = null; }}
          >
            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-5 h-5 rounded-full pointer-events-none"
              style={{
                left: `${(hue / 360) * 100}%`,
                backgroundColor: hueCssColor,
                boxShadow: '0 0 0 2px white, 0 0 0 3px rgba(0,0,0,0.35)',
              }}
            />
          </div>

          {/* ── HEX + RGB inputs ─────────────────────────────────── */}
          <div className="flex gap-1.5 items-end">
            <div className="flex-1 min-w-0">
              <p className="text-[10px] text-muted-foreground mb-1 text-center">HEX</p>
              <Input
                value={hexInput}
                onChange={(e) => handleHexInput(e.target.value)}
                className="bg-muted border-border font-mono text-xs h-8 text-center px-1"
                maxLength={7}
                placeholder="#D4A843"
              />
            </div>
            {(['R', 'G', 'B'] as const).map((ch, i) => {
              const vals = [rInput, gInput, bInput];
              const keys = ['r', 'g', 'b'] as const;
              return (
                <div key={ch} className="w-[46px]">
                  <p className="text-[10px] text-muted-foreground mb-1 text-center">{ch}</p>
                  <Input
                    value={vals[i]}
                    onChange={(e) => handleRgbInput(keys[i], e.target.value.replace(/\D/g, ''))}
                    onBlur={(e) => {
                      const n = Math.max(0, Math.min(255, parseInt(e.target.value) || 0));
                      handleRgbInput(keys[i], String(n));
                    }}
                    className="bg-muted border-border font-mono text-xs h-8 text-center px-1"
                    maxLength={3}
                    placeholder="0"
                  />
                </div>
              );
            })}
            <button
              onClick={copy}
              className="h-8 w-8 flex-shrink-0 flex items-center justify-center rounded-md bg-muted border border-border hover:border-primary/50 transition-colors mb-0"
              title="Copiar HEX"
            >
              {copied
                ? <Check className="w-3.5 h-3.5 text-green-500" />
                : <Copy className="w-3.5 h-3.5 text-muted-foreground" />}
            </button>
          </div>

          {/* ── Preset swatches ──────────────────────────────────── */}
          <div>
            <p className="text-[10px] text-muted-foreground mb-1.5 uppercase tracking-wide">Colores rápidos</p>
            <div className="grid grid-cols-8 gap-1">
              {PRESET_SWATCHES.map((c) => (
                <button
                  key={c}
                  onClick={() => applyPreset(c)}
                  className={cn(
                    'w-8 h-8 rounded-md transition-all hover:scale-110 border-2',
                    value.toLowerCase() === c.toLowerCase()
                      ? 'border-white ring-2 ring-primary/50 scale-110'
                      : 'border-transparent hover:border-white/30'
                  )}
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
            </div>
          </div>

          {/* ── Current color preview ─────────────────────────────── */}
          <div className="flex items-center gap-2 pt-1 border-t border-border">
            <div className="w-7 h-7 rounded-md border border-border" style={{ backgroundColor: value }} />
            <span className="text-xs text-muted-foreground font-mono">{value.toUpperCase()}</span>
            <div className="w-7 h-7 rounded-md border border-border ml-auto" style={{ backgroundColor: displayHex }} />
            <span className="text-xs text-muted-foreground font-mono">{displayHex.toUpperCase()}</span>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
