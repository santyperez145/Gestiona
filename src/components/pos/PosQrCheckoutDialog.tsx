import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Loader2,
  LocateFixed,
  MapPin,
  QrCode,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatARS } from "@/lib/supabaseStore";
import {
  posQrFailureCopy,
  posQrRemainingLabel,
  posQrRemainingSeconds,
  posQrRequiresManualReview,
  type PosQrPhase,
  type PosQrSession,
  type PosQrSetupPayload,
} from "@/lib/posQr";
import { toast } from "sonner";
import LiquidacionEstimada from "@/components/integrations/LiquidacionEstimada";

interface Props {
  phase: PosQrPhase;
  session: PosQrSession | null;
  amount: number;
  businessName: string;
  orgId?: string;
  planId?: string | null;
  error?: string | null;
  onRetry: () => void;
  onCancel: () => void;
  onChooseOtherMethod: () => void;
  onSetup: (payload: PosQrSetupPayload) => void;
}

const emptySetup = (businessName: string) => ({
  storeName: businessName || "Sucursal principal",
  streetName: "",
  streetNumber: "",
  cityName: "",
  stateName: "",
  latitude: "",
  longitude: "",
  reference: "",
});

export function PosQrCheckoutDialog({
  phase,
  session,
  amount,
  businessName,
  orgId,
  planId,
  error,
  onRetry,
  onCancel,
  onChooseOtherMethod,
  onSetup,
}: Props) {
  const [now, setNow] = useState(Date.now());
  const [locating, setLocating] = useState(false);
  const [setup, setSetup] = useState(() => emptySetup(businessName));

  useEffect(() => {
    if (phase !== "pending") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (phase === "setup" && !setup.storeName) {
      setSetup((current) => ({ ...current, storeName: businessName || "Sucursal principal" }));
    }
  }, [phase, businessName, setup.storeName]);

  const locate = () => {
    if (!navigator.geolocation) {
      toast.error("Este dispositivo no permite obtener la ubicación");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setSetup((current) => ({
          ...current,
          latitude: String(coords.latitude),
          longitude: String(coords.longitude),
        }));
        setLocating(false);
        toast.success("Coordenadas cargadas; verificá que correspondan al local");
      },
      () => {
        setLocating(false);
        toast.error("No se pudo obtener la ubicación. Podés cargarla manualmente.");
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  };

  const submitSetup = () => {
    const latitude = Number(setup.latitude);
    const longitude = Number(setup.longitude);
    if (!setup.storeName.trim() || !setup.streetName.trim() || !setup.streetNumber.trim()
      || !setup.cityName.trim() || !setup.stateName.trim()
      || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      toast.error("Completá el domicilio y las coordenadas reales del local");
      return;
    }
    onSetup({
      storeName: setup.storeName.trim(),
      streetName: setup.streetName.trim(),
      streetNumber: setup.streetNumber.trim(),
      cityName: setup.cityName.trim(),
      stateName: setup.stateName.trim(),
      latitude,
      longitude,
      reference: setup.reference.trim() || undefined,
    });
  };

  const remaining = posQrRemainingSeconds(session?.expires_at, now);
  const isBusy = phase === "preparing" || phase === "cancelling";
  const requiresManualReview = posQrRequiresManualReview(session);

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !isBusy) onCancel(); }}>
      <DialogContent size="md" className="overflow-hidden border-primary/20 p-0">
        <div className="bg-gradient-to-br from-sky-500/10 via-background to-primary/10 px-6 pt-6 pb-4">
          <DialogHeader>
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-500/15 text-sky-500 ring-1 ring-sky-500/20">
                <QrCode className="h-6 w-6" />
              </div>
              <span className="rounded-full border border-sky-500/20 bg-sky-500/10 px-3 py-1 text-[11px] font-semibold text-sky-600 dark:text-sky-300">
                Mercado Pago · QR dinámico
              </span>
            </div>
            <DialogTitle>
              {phase === "setup" ? "Configurá la caja una sola vez" : "Cobro presencial seguro"}
            </DialogTitle>
            <DialogDescription>
              {phase === "setup"
                ? "Mercado Pago necesita una sucursal real y una caja asociada antes del primer QR."
                : "La venta y el stock se confirman únicamente después de la acreditación."}
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="px-6 pb-6">
          {phase === "setup" ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
                <div className="flex gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>Usá datos reales: Mercado Pago los utiliza con fines fiscales y muestra la sucursal en sus mapas. Gestiona guarda sólo los identificadores de la integración, nunca el token en el navegador.</p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5 sm:col-span-2">
                  <span className="text-xs font-medium">Nombre de la sucursal</span>
                  <Input value={setup.storeName} onChange={(event) => setSetup({ ...setup, storeName: event.target.value })} maxLength={60} />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-medium">Calle</span>
                  <Input value={setup.streetName} onChange={(event) => setSetup({ ...setup, streetName: event.target.value })} placeholder="Av. Corrientes" maxLength={120} />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-medium">Número</span>
                  <Input value={setup.streetNumber} onChange={(event) => setSetup({ ...setup, streetNumber: event.target.value })} placeholder="1234" maxLength={20} />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-medium">Ciudad</span>
                  <Input value={setup.cityName} onChange={(event) => setSetup({ ...setup, cityName: event.target.value })} placeholder="CABA" maxLength={100} />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-medium">Provincia</span>
                  <Input value={setup.stateName} onChange={(event) => setSetup({ ...setup, stateName: event.target.value })} placeholder="Buenos Aires" maxLength={100} />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-medium">Latitud</span>
                  <Input value={setup.latitude} onChange={(event) => setSetup({ ...setup, latitude: event.target.value })} inputMode="decimal" placeholder="-34.6037" />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-medium">Longitud</span>
                  <Input value={setup.longitude} onChange={(event) => setSetup({ ...setup, longitude: event.target.value })} inputMode="decimal" placeholder="-58.3816" />
                </label>
                <label className="space-y-1.5 sm:col-span-2">
                  <span className="text-xs font-medium">Referencia opcional</span>
                  <Input value={setup.reference} onChange={(event) => setSetup({ ...setup, reference: event.target.value })} placeholder="Local a la calle" maxLength={120} />
                </label>
              </div>
              <Button variant="outline" className="w-full gap-2" onClick={locate} disabled={locating || isBusy}>
                {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />}
                Usar ubicación de este dispositivo
              </Button>
            </div>
          ) : phase === "pending" && session?.qr_data ? (
            <div className="space-y-4 text-center">
              <div className="mx-auto -mt-1 w-fit rounded-[24px] bg-white p-4 shadow-xl shadow-sky-500/10 ring-1 ring-black/5">
                <QRCodeSVG value={session.qr_data} size={248} level="M" marginSize={1} />
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Total a pagar</p>
                <p className="mt-1 text-3xl font-bold tracking-tight text-foreground">{formatARS(Number(session.amount || amount))}</p>
              </div>
              <LiquidacionEstimada
                orgId={orgId}
                planId={planId}
                bruto={Number(session.amount || amount)}
                provider="mercadopago"
                method="wallet"
                channel="pos"
              />
              <div className="mx-auto flex w-fit items-center gap-2 rounded-full bg-sky-500/10 px-3 py-1.5 text-xs font-semibold text-sky-600 dark:text-sky-300">
                <span className="h-2 w-2 animate-pulse rounded-full bg-sky-500" />
                Esperando acreditación
              </div>
              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <Clock3 className="h-4 w-4" />
                Vence en <span className="font-mono font-semibold text-foreground">{posQrRemainingLabel(remaining)}</span>
              </div>
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-left text-xs leading-relaxed text-muted-foreground">
                <div className="flex gap-2">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                  <p>El importe fue calculado por Gestiona y la consulta se hace directo a Mercado Pago. No cierres el cobro hasta ver “Venta acreditada”.</p>
                </div>
              </div>
            </div>
          ) : phase === "error" ? (
            <div className="space-y-4 py-2">
              <div className="flex items-start gap-3 rounded-xl border border-destructive/25 bg-destructive/5 p-4">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                <div>
                  <p className="text-sm font-semibold">El cobro no se cerró</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{error || posQrFailureCopy(session)}</p>
                </div>
              </div>
              <p className="text-center text-xs text-muted-foreground">
                {requiresManualReview
                  ? "No vuelvas a cobrar: verificá el movimiento en Mercado Pago antes de continuar."
                  : "No se creó una venta ni se descontó stock por este intento."}
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4 py-12 text-center">
              {phase === "cancelling"
                ? <X className="h-10 w-10 text-muted-foreground" />
                : <Loader2 className="h-10 w-10 animate-spin text-sky-500" />}
              <div>
                <p className="font-semibold">{phase === "cancelling" ? "Cancelando el QR…" : "Preparando el cobro…"}</p>
                <p className="mt-1 text-xs text-muted-foreground">{phase === "cancelling" ? "Esperamos la confirmación del proveedor." : "Validamos precio, stock y permisos antes de mostrarlo."}</p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-border/70 bg-muted/30 px-6 py-4">
          {phase === "setup" ? (
            <>
              <Button variant="ghost" onClick={onChooseOtherMethod} disabled={isBusy}>Usar otro medio</Button>
              <Button onClick={submitSetup} disabled={isBusy} className="gap-2">
                {isBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                Crear sucursal y caja
              </Button>
            </>
          ) : phase === "pending" ? (
            <Button variant="outline" onClick={onCancel} className="w-full">Cancelar cobro</Button>
          ) : phase === "error" && requiresManualReview ? (
            <Button variant="outline" onClick={onCancel} className="w-full">Cerrar para revisar</Button>
          ) : phase === "error" ? (
            <>
              <Button variant="ghost" onClick={onChooseOtherMethod}>Cambiar medio</Button>
              <Button onClick={onRetry} className="gap-2"><RefreshCw className="h-4 w-4" />Reintentar</Button>
            </>
          ) : (
            <div className="flex w-full items-center justify-center gap-2 text-xs text-muted-foreground">
              {phase === "preparing" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              Operación protegida contra duplicados
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
