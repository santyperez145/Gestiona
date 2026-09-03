import { useLiquidacionEstimada } from "@/hooks/useLiquidacionEstimada";
import type { Channel } from "@/lib/paymentFees";

const ars = (n: number) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n);

/** Desglose compacto para el momento de cobrar. Estimación, no el cobro real. */
export default function LiquidacionEstimada({
  orgId,
  planId,
  bruto,
  provider,
  method,
  channel = "online",
}: {
  orgId?: string;
  planId?: string | null;
  bruto: number;
  provider: string;
  method?: string;
  channel?: Channel;
}) {
  const { settlement, error, cargando } = useLiquidacionEstimada({
    orgId, planId, bruto, provider, method, channel,
  });

  if (cargando || bruto <= 0) return null;
  if (error || !settlement) return null;

  return (
    <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-left text-xs leading-relaxed text-muted-foreground">
      <p className="font-medium text-foreground">Qué te queda, estimado</p>
      <p className="mt-1">
        Arancel {ars(settlement.providerFee)}
        {" · "}IVA {ars(settlement.providerFeeIva)}
        {" · "}Nerqia {settlement.platformFee > 0 ? ars(settlement.platformFee) : "sin comisión vigente"}
      </p>
      <p className="mt-1 text-foreground">
        Te acreditan <strong>{ars(settlement.net)}</strong>
        {settlement.releaseDays != null && settlement.releaseDays > 0
          ? ` · en ${settlement.releaseDays} día${settlement.releaseDays === 1 ? "" : "s"}`
          : null}
      </p>
      <p className="mt-1">
        Es el tarifario cargado, no lo que el proveedor informe en este cobro.
      </p>
    </div>
  );
}
