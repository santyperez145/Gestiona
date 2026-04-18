import { useMemo, useState } from "react";
import { AlertTriangle, Wrench, X, CheckCircle2 } from "lucide-react";
import { detectConsistencyIssues } from "@/lib/cashFlow";
import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/lib/auditLog";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export default function ConsistencyAlerts({
  sales, debts, products, settings, userId, onRepair,
}: { sales: any[]; debts: any[]; products: any[]; settings: any; userId: string; onRepair: () => void }) {
  const [dismissed, setDismissed] = useState(false);
  const [repairing, setRepairing] = useState(false);

  const issues = useMemo(() => detectConsistencyIssues({ sales, debts, products, settings }), [sales, debts, products, settings]);

  if (dismissed || issues.length === 0) return null;

  const handleRepair = async () => {
    setRepairing(true);
    try {
      let fixed = 0;
      for (const issue of issues) {
        if (issue.kind === 'sale_not_paid' && issue.ids.length) {
          const { error } = await supabase.from('sales').update({ paid: true }).in('id', issue.ids);
          if (!error) fixed += issue.ids.length;
        }
        if (issue.kind === 'outdated_cost' && issue.ids.length) {
          const customs = Number(settings?.customs_percent || 15);
          for (const id of issue.ids) {
            const p = products.find(x => x.id === id);
            if (!p) continue;
            const newCost = Number(p.cost_usd) * (1 + customs / 100);
            const newCustomsFee = Number(p.cost_usd) * (customs / 100);
            await supabase.from('products').update({ total_cost_usd: newCost, customs_fee: newCustomsFee }).eq('id', id);
            fixed++;
          }
        }
      }
      await logAudit(userId, 'update', 'settings', undefined, { auto_repair: true, count: fixed });
      toast.success(`${fixed} inconsistencias reparadas`);
      onRepair();
    } catch (e: any) {
      toast.error(`Error: ${e.message}`);
    } finally {
      setRepairing(false);
    }
  };

  return (
    <div className="bg-warning/5 border border-warning/30 rounded-xl p-4 mb-6 relative">
      <button onClick={() => setDismissed(true)} className="absolute top-3 right-3 text-muted-foreground hover:text-foreground">
        <X className="w-4 h-4" />
      </button>
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-warning/15 flex items-center justify-center shrink-0">
          <AlertTriangle className="w-5 h-5 text-warning" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-display font-semibold text-sm mb-1">Auditoría detectó {issues.length} inconsistencia{issues.length > 1 ? 's' : ''}</h3>
          <ul className="text-xs text-muted-foreground space-y-0.5 mb-3">
            {issues.map((i, idx) => (
              <li key={idx} className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3 h-3 text-warning shrink-0" /> {i.label}
              </li>
            ))}
          </ul>
          <Button size="sm" onClick={handleRepair} disabled={repairing} className="bg-warning text-warning-foreground hover:bg-warning/90 h-8">
            <Wrench className="w-3.5 h-3.5 mr-1.5" />
            {repairing ? 'Reparando...' : 'Reparar automáticamente'}
          </Button>
        </div>
      </div>
    </div>
  );
}
