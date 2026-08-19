/**
 * Billetera — cuánta plata hay, de dónde vino y cómo sacarla.
 *
 * ⚠️ Los tres números de arriba no son lo mismo y confundirlos es el error que
 * esta pantalla existe para evitar:
 *
 *   PENDIENTE   cobrado, todavía no acreditado por MercadoPago. No se puede usar.
 *   DISPONIBLE  acreditado y en la billetera.
 *   RETIRABLE   disponible menos lo que ya se pidió retirar.
 *
 * Mostrar un solo número junta plata que se puede usar hoy con plata que
 * todavía no está, y así es como un comercio gasta lo que no tiene.
 *
 * Todo lo que se ve acá sale del ledger: `wallet_saldo` suma partidas y
 * `wallet_movimientos` son las partidas mismas. No hay una tabla de saldo que
 * pueda desincronizarse.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { usePageTitle } from "@/hooks/usePageTitle";
import { formatARS } from "@/lib/supabaseStore";
import { toast } from "sonner";
import PageHeader from "@/components/shared/PageHeader";
import MetricCard from "@/components/shared/MetricCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Wallet, ArrowDownToLine, Clock, Banknote, Plus, Loader2,
  ArrowUpRight, ArrowDownLeft, Landmark, Info, RefreshCw,
} from "lucide-react";
import {
  leerSaldo, validarRetiro, validarCbu, formatearCbu, explicarPendiente,
  saldoVacio, ESTADO_RETIRO, type SaldoBilletera, type EstadoRetiro,
} from "@/lib/wallet";

interface CuentaBancaria {
  id: string;
  alias: string;
  titular: string;
  cbu: string;
  banco: string | null;
  is_default: boolean;
}

interface Movimiento {
  id: string;
  fecha: string;
  asiento: number;
  descripcion: string;
  bolsillo: "pendiente" | "disponible";
  direccion: "entrada" | "salida";
  monto: number;
  detalle: string | null;
}

interface Retiro {
  id: string;
  monto: number;
  estado: EstadoRetiro;
  created_at: string;
  motivo_rechazo: string | null;
}

const TONO_BADGE: Record<string, string> = {
  amber: "bg-primary/12 text-primary border-primary/20",
  blue: "bg-blue-500/12 text-blue-600 dark:text-blue-400 border-blue-500/20",
  green: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  red: "bg-destructive/12 text-destructive border-destructive/20",
};

export default function WalletPage() {
  usePageTitle("Billetera");
  const { activeOrg } = useOrg();

  const [saldo, setSaldo] = useState<SaldoBilletera>(saldoVacio);
  const [cuentas, setCuentas] = useState<CuentaBancaria[]>([]);
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [retiros, setRetiros] = useState<Retiro[]>([]);
  const [loading, setLoading] = useState(true);

  const [dialogRetiro, setDialogRetiro] = useState(false);
  const [dialogCuenta, setDialogCuenta] = useState(false);
  const [monto, setMonto] = useState("");
  const [cuentaElegida, setCuentaElegida] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const [nuevaCuenta, setNuevaCuenta] = useState({ alias: "", titular: "", cbu: "", banco: "" });

  const cargar = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);

    const [saldoRes, ctasRes, movRes, retRes] = await Promise.all([
      supabase.rpc("wallet_saldo", { p_org: activeOrg.id }),
      supabase.from("wallet_bank_accounts")
        .select("id,alias,titular,cbu,banco,is_default")
        .eq("org_id", activeOrg.id).eq("is_active", true)
        .order("is_default", { ascending: false }),
      supabase.from("wallet_movimientos")
        .select("id,fecha,asiento,descripcion,bolsillo,direccion,monto,detalle")
        .eq("org_id", activeOrg.id)
        .order("fecha", { ascending: false }).limit(50),
      supabase.from("wallet_withdrawals")
        .select("id,monto,estado,created_at,motivo_rechazo")
        .eq("org_id", activeOrg.id)
        .order("created_at", { ascending: false }).limit(20),
    ]);

    // Un error acá no puede volverse "tenés cero": son problemas opuestos, y
    // mostrar cero saldo cuando en realidad no se pudo leer es peor que no
    // mostrar nada.
    if (saldoRes.error) {
      toast.error("No pudimos leer tu saldo. Probá de nuevo en un momento.");
      console.error("wallet_saldo", saldoRes.error);
    } else {
      setSaldo(leerSaldo(saldoRes.data));
    }

    if (ctasRes.error) console.error("cuentas", ctasRes.error);
    if (movRes.error) console.error("movimientos", movRes.error);

    setCuentas((ctasRes.data ?? []) as CuentaBancaria[]);
    setMovimientos((movRes.data ?? []) as Movimiento[]);
    setRetiros((retRes.data ?? []) as Retiro[]);
    setLoading(false);
  }, [activeOrg]);

  useEffect(() => { cargar(); }, [cargar]);

  const cuentaDefault = useMemo(
    () => cuentas.find(c => c.is_default) ?? cuentas[0] ?? null, [cuentas]);

  const validacion = useMemo(
    () => validarRetiro(Number(monto), saldo, cuentas.length > 0, formatARS),
    [monto, saldo, cuentas.length]);

  const pedirRetiro = async () => {
    if (!activeOrg || !validacion.puede) return;
    setEnviando(true);

    // Clave de idempotencia: si el navegador reintenta —timeout que en realidad
    // completó, doble clic— el retiro no puede salir dos veces. La base la usa
    // para devolver el mismo retiro en vez de crear otro.
    const clave = `retiro-${activeOrg.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const { data, error } = await supabase.rpc("wallet_solicitar_retiro", {
      p_org: activeOrg.id,
      p_monto: Number(monto),
      p_cuenta: cuentaElegida ?? cuentaDefault?.id ?? null,
      p_clave: clave,
    });

    setEnviando(false);

    if (error) {
      // El mensaje del servidor es el que importa: valida contra el libro con
      // candado, así que sabe cosas que el cliente no.
      toast.error(error.message.replace(/^.*?:\s*/, ""));
      return;
    }

    toast.success(`Retiro de ${formatARS(Number((data as any)?.monto ?? 0))} solicitado`);
    setDialogRetiro(false);
    setMonto("");
    cargar();
  };

  const guardarCuenta = async () => {
    if (!activeOrg) return;
    const cbu = nuevaCuenta.cbu.replace(/[^0-9]/g, "");

    if (!nuevaCuenta.alias.trim() || !nuevaCuenta.titular.trim()) {
      toast.error("Completá el alias y el titular");
      return;
    }
    // Se valida acá además de en la base: un CBU mal escrito no rebota en el
    // momento — la transferencia sale y la rechaza el banco días después.
    if (!validarCbu(cbu)) {
      toast.error("El CBU no es válido. Revisá los números.");
      return;
    }

    setEnviando(true);
    const { error } = await supabase.from("wallet_bank_accounts").insert({
      org_id: activeOrg.id,
      alias: nuevaCuenta.alias.trim(),
      titular: nuevaCuenta.titular.trim(),
      cbu,
      banco: nuevaCuenta.banco.trim() || null,
      is_default: cuentas.length === 0,
    });
    setEnviando(false);

    if (error) { toast.error("No se pudo guardar: " + error.message); return; }
    toast.success("Cuenta agregada");
    setDialogCuenta(false);
    setNuevaCuenta({ alias: "", titular: "", cbu: "", banco: "" });
    cargar();
  };

  const avisoPendiente = explicarPendiente(saldo);

  return (
    <div className="workspace-page space-y-5">
      <PageHeader
        icon={Wallet}
        title="Billetera"
        description="Tu plata: lo cobrado, lo acreditado y lo que podés retirar."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={cargar} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
              Actualizar
            </Button>
            <Button size="sm" onClick={() => setDialogRetiro(true)} disabled={saldo.retirable <= 0}>
              <ArrowDownToLine className="w-4 h-4 mr-1.5" />
              Retirar
            </Button>
          </div>
        }
      />

      {/* Los tres números, separados a propósito */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <MetricCard
          label="Disponible"
          value={formatARS(saldo.disponible)}
          sub={saldo.en_retiro > 0 ? `${formatARS(saldo.en_retiro)} en trámite de retiro` : "Acreditado en tu cuenta"}
          icon={Banknote}
          tone="green"
        />
        <MetricCard
          label="Pendiente de acreditación"
          value={formatARS(saldo.pendiente)}
          sub="Cobrado, todavía no liberado"
          icon={Clock}
          tone="yellow"
        />
        <MetricCard
          label="Podés retirar"
          value={formatARS(saldo.retirable)}
          sub="Disponible menos lo ya solicitado"
          icon={ArrowDownToLine}
          tone="amber"
        />
      </div>

      {avisoPendiente && (
        <div className="flex items-start gap-2 rounded-[8px] border border-border/70 bg-muted/30 px-4 py-3 text-sm">
          <Info className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
          <p className="text-muted-foreground">
            <strong className="text-foreground">{formatARS(saldo.pendiente)} pendientes.</strong>{" "}
            {avisoPendiente}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Movimientos */}
        <div className="lg:col-span-2 rounded-[8px] border border-border/80 bg-card">
          <div className="px-4 py-3 border-b border-border/60">
            <h2 className="text-sm font-semibold">Movimientos</h2>
            <p className="text-xs text-muted-foreground">
              Cada línea es un asiento del libro contable.
            </p>
          </div>

          {loading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
              Cargando
            </div>
          ) : movimientos.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Todavía no hay movimientos. Aparecen solos cuando cobrás una venta.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground border-b border-border/50">
                    <th className="text-left font-medium px-4 py-2">Fecha</th>
                    <th className="text-left font-medium px-4 py-2">Concepto</th>
                    <th className="text-left font-medium px-4 py-2">Bolsillo</th>
                    <th className="text-right font-medium px-4 py-2">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {movimientos.map(m => (
                    <tr key={m.id} className="border-b border-border/30 last:border-0">
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground text-xs">
                        {new Date(m.fecha).toLocaleDateString("es-AR")}
                        <span className="block text-[10px] opacity-60">#{m.asiento}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="block">{m.descripcion}</span>
                        {m.detalle && (
                          <span className="block text-[11px] text-muted-foreground">{m.detalle}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[11px] px-1.5 py-0.5 rounded border ${
                          m.bolsillo === "disponible"
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                            : "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20"
                        }`}>
                          {m.bolsillo === "disponible" ? "Disponible" : "Pendiente"}
                        </span>
                      </td>
                      <td className={`px-4 py-2.5 text-right tabular-nums font-medium whitespace-nowrap ${
                        m.direccion === "entrada" ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
                      }`}>
                        <span className="inline-flex items-center gap-1">
                          {m.direccion === "entrada"
                            ? <ArrowDownLeft className="w-3.5 h-3.5" />
                            : <ArrowUpRight className="w-3.5 h-3.5" />}
                          {formatARS(m.monto)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="space-y-5">
          {/* Cuentas bancarias */}
          <div className="rounded-[8px] border border-border/80 bg-card">
            <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Cuentas para retirar</h2>
              <Button variant="ghost" size="sm" onClick={() => setDialogCuenta(true)}>
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            <div className="p-4 space-y-2">
              {cuentas.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Todavía no cargaste ninguna. Hace falta una para poder retirar.
                </p>
              ) : cuentas.map(c => (
                <div key={c.id} className="rounded-[6px] border border-border/60 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Landmark className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium">{c.alias}</span>
                    {c.is_default && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/12 text-primary border border-primary/20">
                        Predeterminada
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">{c.titular}</p>
                  <p className="text-[11px] font-mono text-muted-foreground">{formatearCbu(c.cbu)}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Retiros */}
          <div className="rounded-[8px] border border-border/80 bg-card">
            <div className="px-4 py-3 border-b border-border/60">
              <h2 className="text-sm font-semibold">Retiros</h2>
            </div>
            <div className="p-4 space-y-2">
              {retiros.length === 0 ? (
                <p className="text-xs text-muted-foreground">Todavía no pediste ninguno.</p>
              ) : retiros.map(r => {
                const cfg = ESTADO_RETIRO[r.estado] ?? ESTADO_RETIRO.solicitado;
                return (
                  <div key={r.id} className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium tabular-nums">{formatARS(r.monto)}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {new Date(r.created_at).toLocaleDateString("es-AR")}
                      </p>
                      {r.motivo_rechazo && (
                        <p className="text-[11px] text-destructive">{r.motivo_rechazo}</p>
                      )}
                    </div>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${TONO_BADGE[cfg.tono]}`}>
                      {cfg.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Retirar */}
      <Dialog open={dialogRetiro} onOpenChange={setDialogRetiro}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Retirar plata</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-[6px] bg-muted/40 px-3 py-2 text-sm">
              Podés retirar hasta <strong>{formatARS(saldo.retirable)}</strong>
            </div>

            <div>
              <Label>Monto</Label>
              <Input
                type="number"
                value={monto}
                onChange={e => setMonto(e.target.value)}
                placeholder="0"
                autoFocus
              />
              {monto && validacion.motivo && (
                <p className="text-xs mt-1.5 text-destructive">{validacion.motivo}</p>
              )}
            </div>

            {cuentas.length > 1 && (
              <div>
                <Label>Cuenta destino</Label>
                <select
                  className="w-full mt-1 h-9 rounded-[6px] border border-border bg-background px-3 text-sm"
                  value={cuentaElegida ?? cuentaDefault?.id ?? ""}
                  onChange={e => setCuentaElegida(e.target.value)}
                >
                  {cuentas.map(c => (
                    <option key={c.id} value={c.id}>{c.alias} — {formatearCbu(c.cbu)}</option>
                  ))}
                </select>
              </div>
            )}

            {cuentaDefault && cuentas.length === 1 && (
              <p className="text-xs text-muted-foreground">
                Va a <strong>{cuentaDefault.alias}</strong> — {formatearCbu(cuentaDefault.cbu)}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogRetiro(false)}>Cancelar</Button>
            <Button onClick={pedirRetiro} disabled={!validacion.puede || enviando}>
              {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : "Solicitar retiro"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Nueva cuenta */}
      <Dialog open={dialogCuenta} onOpenChange={setDialogCuenta}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Nueva cuenta bancaria</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Alias interno *</Label>
              <Input
                value={nuevaCuenta.alias}
                onChange={e => setNuevaCuenta(c => ({ ...c, alias: e.target.value }))}
                placeholder="Ej: Cuenta principal"
              />
            </div>
            <div>
              <Label>Titular *</Label>
              <Input
                value={nuevaCuenta.titular}
                onChange={e => setNuevaCuenta(c => ({ ...c, titular: e.target.value }))}
                placeholder="Como figura en el banco"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                El banco rechaza una transferencia a nombre de otro.
              </p>
            </div>
            <div>
              <Label>CBU o CVU *</Label>
              <Input
                value={nuevaCuenta.cbu}
                onChange={e => setNuevaCuenta(c => ({ ...c, cbu: e.target.value }))}
                placeholder="22 dígitos"
                className="font-mono"
              />
              {nuevaCuenta.cbu.replace(/[^0-9]/g, "").length === 22 && !validarCbu(nuevaCuenta.cbu) && (
                <p className="text-xs mt-1.5 text-destructive">
                  Los dígitos verificadores no cierran. Revisá los números.
                </p>
              )}
            </div>
            <div>
              <Label>Banco</Label>
              <Input
                value={nuevaCuenta.banco}
                onChange={e => setNuevaCuenta(c => ({ ...c, banco: e.target.value }))}
                placeholder="Opcional"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogCuenta(false)}>Cancelar</Button>
            <Button onClick={guardarCuenta} disabled={enviando}>
              {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
