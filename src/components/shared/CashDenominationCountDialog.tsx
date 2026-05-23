/**
 * CashDenominationCountDialog — Physical cash counting interface.
 *
 * Displays an interactive denomination calculator for ARS banknotes and coins.
 * User enters the quantity of each denomination; the dialog calculates the total
 * and shows difference vs expected cash balance.
 *
 * Denominations (ARS 2024):
 *   Billetes: 10000, 5000, 2000, 1000, 500, 200, 100
 *   Monedas:  50, 25, 10, 5, 1
 *
 * Usage:
 *   <CashDenominationCountDialog
 *     open={open}
 *     onClose={() => setOpen(false)}
 *     expectedBalance={cashSession.expected_close}
 *     onConfirm={(total) => setCountedAmount(total)}
 *   />
 */
import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatARS } from "@/lib/supabaseStore";
import { Banknote, Coins, Check, X, RefreshCw } from "lucide-react";

interface Denomination {
  value: number;
  label: string;
  type: "bill" | "coin";
}

const DENOMINATIONS: Denomination[] = [
  { value: 10000, label: "$10.000", type: "bill" },
  { value: 5000,  label: "$5.000",  type: "bill" },
  { value: 2000,  label: "$2.000",  type: "bill" },
  { value: 1000,  label: "$1.000",  type: "bill" },
  { value: 500,   label: "$500",    type: "bill" },
  { value: 200,   label: "$200",    type: "bill" },
  { value: 100,   label: "$100",    type: "bill" },
  { value: 50,    label: "$50",     type: "coin" },
  { value: 25,    label: "$25",     type: "coin" },
  { value: 10,    label: "$10",     type: "coin" },
  { value: 5,     label: "$5",      type: "coin" },
  { value: 1,     label: "$1",      type: "coin" },
];

interface Props {
  open: boolean;
  onClose: () => void;
  expectedBalance?: number;
  onConfirm: (total: number, breakdown: Record<number, number>) => void;
  title?: string;
}

export default function CashDenominationCountDialog({
  open,
  onClose,
  expectedBalance,
  onConfirm,
  title = "Conteo de efectivo",
}: Props) {
  const [counts, setCounts] = useState<Record<number, string>>({});

  const reset = () => setCounts({});

  const setCount = (value: number, qty: string) => {
    setCounts(prev => ({ ...prev, [value]: qty }));
  };

  const total = useMemo(() => {
    return DENOMINATIONS.reduce((sum, d) => {
      const qty = parseInt(counts[d.value] || "0") || 0;
      return sum + qty * d.value;
    }, 0);
  }, [counts]);

  const difference = expectedBalance !== undefined ? total - expectedBalance : null;

  const bills = DENOMINATIONS.filter(d => d.type === "bill");
  const coins = DENOMINATIONS.filter(d => d.type === "coin");

  const handleConfirm = () => {
    const breakdown: Record<number, number> = {};
    DENOMINATIONS.forEach(d => {
      const qty = parseInt(counts[d.value] || "0") || 0;
      if (qty > 0) breakdown[d.value] = qty;
    });
    onConfirm(total, breakdown);
    onClose();
  };

  const DenomRow = ({ d }: { d: Denomination }) => {
    const qty = parseInt(counts[d.value] || "0") || 0;
    const subtotal = qty * d.value;
    return (
      <div className="flex items-center gap-3 py-2 border-b border-border/30 last:border-0">
        <span className={`w-16 text-sm font-mono font-semibold ${d.type === "bill" ? "text-primary" : "text-muted-foreground"}`}>
          {d.label}
        </span>
        <span className="text-xs text-muted-foreground w-12 text-center">× </span>
        <Input
          type="number"
          min="0"
          step="1"
          value={counts[d.value] ?? ""}
          onChange={e => setCount(d.value, e.target.value)}
          className="w-20 h-8 text-center text-sm bg-muted border-border"
          placeholder="0"
        />
        <span className="text-xs text-muted-foreground ml-auto text-right w-24 font-mono">
          {subtotal > 0 ? formatARS(subtotal) : "—"}
        </span>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="bg-[hsl(228_24%_7%)] border-border/60 max-w-sm max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-base">
            <Banknote className="w-4 h-4 text-primary" />
            {title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Bills section */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Banknote className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Billetes</span>
            </div>
            <div className="rounded-lg border border-border/40 bg-muted/10 px-3 divide-y divide-border/20">
              {bills.map(d => <DenomRow key={d.value} d={d} />)}
            </div>
          </div>

          {/* Coins section */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Coins className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Monedas</span>
            </div>
            <div className="rounded-lg border border-border/40 bg-muted/10 px-3 divide-y divide-border/20">
              {coins.map(d => <DenomRow key={d.value} d={d} />)}
            </div>
          </div>

          {/* Total */}
          <div className="p-4 rounded-xl bg-primary/5 border border-primary/20 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">Total contado</span>
              <span className="text-xl font-bold font-mono text-primary">{formatARS(total)}</span>
            </div>
            {expectedBalance !== undefined && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Saldo esperado</span>
                <span className="font-mono text-muted-foreground">{formatARS(expectedBalance)}</span>
              </div>
            )}
            {difference !== null && (
              <div className={`flex items-center justify-between text-sm font-semibold rounded-lg p-2 ${Math.abs(difference) < 100 ? "bg-emerald-500/10 text-emerald-400" : difference > 0 ? "bg-blue-500/10 text-blue-400" : "bg-destructive/10 text-destructive"}`}>
                <span>Diferencia</span>
                <span className="font-mono">{difference >= 0 ? "+" : ""}{formatARS(difference)}</span>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="flex gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={reset} className="gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" />Limpiar
          </Button>
          <Button variant="outline" size="sm" onClick={onClose}>
            <X className="w-3.5 h-3.5 mr-1.5" />Cancelar
          </Button>
          <Button size="sm" onClick={handleConfirm} className="gradient-gold text-primary-foreground font-semibold gap-1.5" disabled={total <= 0}>
            <Check className="w-3.5 h-3.5" />
            Confirmar {total > 0 && formatARS(total)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
