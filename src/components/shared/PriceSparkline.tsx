/**
 * PriceSparkline — mini price history chart for the products table.
 *
 * Fetches the last N price_history entries for a product and renders a
 * tiny Recharts sparkline with a tooltip. Shows ▲/▼ delta from first
 * to last data point.
 *
 * Props:
 *   productId — product ID to fetch history for
 *   orgId     — org ID for RLS
 *   width     — chart pixel width (default 72)
 */
import { useEffect, useState, memo } from "react";
import { LineChart, Line, Tooltip, ResponsiveContainer } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { formatARS } from "@/lib/supabaseStore";

interface Props {
  productId: string;
  orgId: string | undefined;
  width?: number;
}

interface Point {
  date: string;
  price: number;
}

const CACHE = new Map<string, Point[]>();

function PriceSparklineInner({ productId, orgId, width = 72 }: Props) {
  const [data, setData] = useState<Point[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    const key = `${orgId}-${productId}`;
    if (CACHE.has(key)) { setData(CACHE.get(key)!); return; }
    setLoading(true);
    supabase
      .from("price_history")
      .select("created_at, new_price_ars")
      .eq("product_id", productId)
      .eq("org_id", orgId)
      .order("created_at", { ascending: true })
      .limit(12)
      .then(({ data: rows }) => {
        if (!rows?.length) { setLoading(false); return; }
        const pts: Point[] = rows.map(r => ({
          date: new Date(r.created_at).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" }),
          price: Number(r.new_price_ars),
        }));
        CACHE.set(key, pts);
        setData(pts);
        setLoading(false);
      });
  }, [productId, orgId]);

  if (loading) return <div className="w-16 h-6 bg-muted/30 rounded animate-pulse" />;
  if (data.length < 2) return null;

  const first = data[0].price;
  const last = data[data.length - 1].price;
  const delta = last - first;
  const deltaPct = first > 0 ? ((delta / first) * 100).toFixed(1) : "0";
  const isUp = delta > 0;
  const isFlat = delta === 0;
  const lineColor = isUp ? "#22c55e" : isFlat ? "#6b7280" : "#ef4444";

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const p = payload[0].payload as Point;
    return (
      <div className="bg-card border border-border/60 px-2 py-1 rounded-lg text-[10px] shadow-xl">
        <p className="text-muted-foreground">{p.date}</p>
        <p className="font-semibold text-foreground">{formatARS(p.price)}</p>
      </div>
    );
  };

  return (
    <div className="flex items-center gap-1.5">
      <div style={{ width, height: 28 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
            <Line
              type="monotone"
              dataKey="price"
              stroke={lineColor}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
            <Tooltip content={<CustomTooltip />} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className={`flex items-center gap-0.5 text-[10px] font-medium ${isUp ? "text-green-400" : isFlat ? "text-muted-foreground" : "text-red-400"}`}>
        {isUp ? <TrendingUp className="w-3 h-3" /> : isFlat ? <Minus className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
        <span>{isUp ? "+" : ""}{deltaPct}%</span>
      </div>
    </div>
  );
}

export const PriceSparkline = memo(PriceSparklineInner);
