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
import { BILLETES, MONEDAS } from "@/lib/arqueo";

interface Denomination {
  value: number;
  label: string;
  type: "bill" | "coin";
}

// Billetes y monedas vigentes del peso (src/lib/arqueo.ts, la misma lista que
// valida la base). Hasta el 2026-10-23 figuraban un billete de $5.000 y una
// moneda de $25 que no existen, y faltaba el de $20.000.
const DENOMINATIONS: Denomination[] = [
  ...BILLETES.map(value => ({ value, label: `$${value.toLocaleString("es-AR")}`, type: "bill" as const })),
  ...MONEDAS.map(value => ({ value, label: `$${value}`, type: "coin" as const })),
];

const idDe = (d: Denomination) => `${d.type}:${d.value}`;

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
  // Por billete o moneda: los $10 existen de las dos formas.
  const [counts, setCounts] = useState<Record<string, string>>({});

  const reset = () => setCounts({});

  const setCount = (id: string, qty: string) => {
    setCounts(prev => ({ ...prev, [id]: qty }));
  };

  const total = useMemo(() => {
    return DENOMINATIONS.reduce((sum, d) => {
      const qty = parseInt(counts[idDe(d)] || "0") || 0;
      return sum + qty * d.value;
    }, 0);
  }, [counts]);

  const difference = expectedBalance !== undefined ? total - expectedBalance : null;

  const bills = DENOMINATIONS.filter(d => d.type === "bill");
  const coins = DENOMINATIONS.filter(d => d.type === "coin");

  const handleConfirm = () => {
    const breakdown: Record<number, number> = {};
    DENOMINATIONS.forEach(d => {
      const qty = parseInt(counts[idDe(d)] || "0") || 0;
      if (qty > 0) breakdown[d.value] = (breakdown[d.value] ?? 0) + qty;
    });
    onConfirm(total, breakdown);
    onClose();
  };

  const DenomRow = ({ d }: { d: Denomination }) => {
    const qty = parseInt(counts[idDe(d)] || "0") || 0;
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
          value={counts[idDe(d)] ?? ""}
          onChange={e => setCount(idDe(d), e.target.value)}
          aria-label={`Cantidad de ${d.type === "bill" ? "billetes" : "monedas"} de ${d.label}`}
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
      <DialogContent className="bg-card border-border/60 max-w-sm max-h-[90vh] overflow-y-auto">
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
              {bills.map(d => <DenomRow key={idDe(d)} d={d} />)}
            </div>
          </div>

          {/* Coins section */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Coins className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Monedas</span>
            </div>
            <div className="rounded-lg border border-border/40 bg-muted/10 px-3 divide-y divide-border/20">
              {coins.map(d => <DenomRow key={idDe(d)} d={d} />)}
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
