import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { Gift, ArrowRight, TrendingUp, Users, Megaphone } from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────
interface ExchangeRow {
  id: string;
  influencer_name: string;
  product_value_ars: number;
  quantity: number;
  sales_generated_ars: number | null;
  influencer_followers: number | null;
  actual_posts: number | null;
  expected_posts: number | null;
  status: string;
}

// Statuses that mean the exchange is no longer "active" (org-configurable codes vary,
// but these common terminal states cover the defaults from marketingExtraDB seeds).
const TERMINAL_STATUSES = new Set(["cancelado", "rechazado", "vencido", "finalizado"]);

// ── Component ────────────────────────────────────────────────────────────────
// Compact rollup of influencer-exchange ROI for the Dashboard — mirrors the
// calculation logic used in InfluencerExchangesPage (/canjes).
export default function InfluencerROIWidget() {
  const { activeOrg } = useOrg();
  const [exchanges, setExchanges] = useState<ExchangeRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeOrg?.id) return;
    setLoading(true);
    supabase
      .from("influencer_exchanges")
      .select("id, influencer_name, product_value_ars, quantity, sales_generated_ars, influencer_followers, actual_posts, expected_posts, status")
      .eq("org_id", activeOrg.id)
      .then(({ data }) => {
        setExchanges((data as ExchangeRow[]) ?? []);
        setLoading(false);
      });
  }, [activeOrg?.id]);

  const stats = useMemo(() => {
    if (exchanges.length === 0) return null;

    const activos = exchanges.filter((e) => !TERMINAL_STATUSES.has(e.status)).length;

    const withRoi = exchanges.map((e) => {
      // product_value_ars stores COST (investment), not sale price — same as /canjes
      const inv = Number(e.product_value_ars || 0) * (e.quantity || 1);
      const sales = Number(e.sales_generated_ars || 0);
      const roi = inv > 0 && sales > 0 ? ((sales - inv) / inv) * 100 : null;
      const reach = (e.influencer_followers || 0) * (e.actual_posts || e.expected_posts || 1);
      return { ...e, inv, sales, roi, reach };
    });

    const roiValues = withRoi.filter((e) => e.roi !== null).map((e) => e.roi as number);
    const avgRoi = roiValues.length > 0 ? roiValues.reduce((s, v) => s + v, 0) / roiValues.length : null;
    const totalReach = withRoi.reduce((s, e) => s + e.reach, 0);
    const topInfluencer = [...withRoi].filter((e) => e.roi !== null).sort((a, b) => (b.roi as number) - (a.roi as number))[0] ?? null;

    return { activos, total: exchanges.length, avgRoi, totalReach, topInfluencer };
  }, [exchanges]);

  if (!activeOrg || loading || !stats) return null;

  return (
    <div className="bg-card border border-border rounded-lg p-4 md:p-5 shadow-card mb-6 md:mb-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-display font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
          <Gift className="w-4 h-4" />ROI de Canjes con Influencers
        </h2>
        <Link to="/canjes" className="text-xs text-primary hover:underline flex items-center gap-1">
          Ver todos <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-muted/30 rounded-lg p-3">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1">Canjes activos</p>
          <p className="text-sm font-bold font-display">
            {stats.activos} <span className="text-xs text-muted-foreground font-normal">/ {stats.total}</span>
          </p>
        </div>
        <div className="bg-muted/30 rounded-lg p-3">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1">
            <TrendingUp className="w-2.5 h-2.5" />ROI promedio
          </p>
          <p className={`text-sm font-bold font-display ${stats.avgRoi === null ? "text-muted-foreground" : stats.avgRoi >= 0 ? "text-emerald-400" : "text-destructive"}`}>
            {stats.avgRoi === null ? "Sin datos" : `${stats.avgRoi >= 0 ? "+" : ""}${stats.avgRoi.toFixed(0)}%`}
          </p>
        </div>
        <div className="bg-muted/30 rounded-lg p-3">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1">
            <Megaphone className="w-2.5 h-2.5" />Alcance total
          </p>
          <p className="text-sm font-bold font-display">{(stats.totalReach / 1000).toFixed(1)}K</p>
        </div>
        <div className="bg-muted/30 rounded-lg p-3">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1">
            <Users className="w-2.5 h-2.5" />Top influencer
          </p>
          {stats.topInfluencer ? (
            <>
              <p className="text-xs font-bold truncate" title={stats.topInfluencer.influencer_name}>{stats.topInfluencer.influencer_name}</p>
              <p className="text-[10px] text-emerald-400 font-semibold">+{(stats.topInfluencer.roi as number).toFixed(0)}% ROI</p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Sin datos de ROI</p>
          )}
        </div>
      </div>
    </div>
  );
}
