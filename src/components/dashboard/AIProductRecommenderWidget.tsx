import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { Brain, ArrowRight } from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────
interface Product {
  id: string;
  name: string;
  price: number;
}

interface Cooccurrence {
  product_a_id: string;
  product_b_id: string;
  cooccurrence_count: number;
}

function fmtARS(n: number) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
}

// ── Component ────────────────────────────────────────────────────────────────
// Compact card showing the top AI-detected cross-sell pairs (co-occurrences).
// Ported from the former standalone AIProductRecommenderPage (`/recomendaciones-ia`).
export default function AIProductRecommenderWidget() {
  const { activeOrg } = useOrg();
  const [products, setProducts] = useState<Product[]>([]);
  const [cooccurrences, setCooccurrences] = useState<Cooccurrence[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeOrg?.id) return;
    setLoading(true);
    Promise.all([
      supabase.from("products").select("id,name,price").eq("org_id", activeOrg.id),
      supabase.from("product_cooccurrences").select("product_a_id,product_b_id,cooccurrence_count")
        .eq("org_id", activeOrg.id).order("cooccurrence_count", { ascending: false }).limit(5),
    ]).then(([prodRes, coRes]) => {
      setProducts(prodRes.data ?? []);
      setCooccurrences(coRes.data ?? []);
      setLoading(false);
    });
  }, [activeOrg?.id]);

  const topPairs = useMemo(() => {
    return cooccurrences.map(c => ({
      a: products.find(p => p.id === c.product_a_id)?.name ?? "—",
      b: products.find(p => p.id === c.product_b_id)?.name ?? "—",
      count: c.cooccurrence_count,
    }));
  }, [cooccurrences, products]);

  if (!activeOrg || loading || topPairs.length === 0) return null;

  return (
    <div className="bg-card border border-border rounded-lg p-4 md:p-5 shadow-card mb-6 md:mb-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-display font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
          <Brain className="w-4 h-4" />AI Recomendador — Cross-sell
        </h2>
        <Link to="/analytics" className="text-xs text-primary hover:underline flex items-center gap-1">
          Ver detalle <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
      <div className="space-y-1.5">
        {topPairs.map((pair, i) => (
          <div key={i} className="flex items-center justify-between gap-2 text-xs px-2 py-1.5 rounded-lg hover:bg-muted/20 transition-colors">
            <span className="truncate flex-1"><span className="font-medium">{pair.a}</span> <span className="text-muted-foreground">+</span> <span className="font-medium">{pair.b}</span></span>
            <span className="text-muted-foreground shrink-0">{pair.count}x juntos</span>
          </div>
        ))}
      </div>
    </div>
  );
}
