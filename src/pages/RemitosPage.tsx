/**
 * Remitos (2026-10-22): lo que se entregó, a quién y cuándo, y lo que falta
 * entregar de cada venta. Ver `src/lib/remitos.ts` y la migración
 * 20261022000400.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle, Ban, CheckCircle2, FileSpreadsheet, MoreHorizontal, PackageCheck, PackageOpen, Plus, Printer, Search, Settings2, Truck,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import WorkspaceState from "@/components/shared/WorkspaceState";
import WorkspaceViewTabs from "@/components/shared/WorkspaceViewTabs";
import { TableSkeleton } from "@/components/shared/PageSkeleton";
import EmitirRemitoDialog, { type VentaParaRemito } from "@/components/remitos/EmitirRemitoDialog";
import {
  AnularRemitoDialog, DetalleDelRemito, EntregarRemitoDialog, EstadoDelRemito, LetraDelRemito, TalonarioDialog,
} from "@/components/remitos/RemitoAcciones";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useEmisorDelRemito } from "@/hooks/useEmisorDelRemito";
import { useOrg } from "@/lib/orgContext";
import { useModulePermissions } from "@/lib/usePermissions";
import { useUserRole } from "@/lib/useUserRole";
import { fechaFiscalArgentina } from "@/lib/arcaInvoice";
import { hoyAR } from "@/lib/fechaAR";
import { descargarCsvContable } from "@/lib/financeExport";
import { normalizar } from "@/lib/navigation";
import {
  avisoDelCai, cantidadLegible, imprimirRemito, letraDelRemito, numeroDeRemito, remitosCsv,
  type EstadoRemito, type Remito, type Talonario,
} from "@/lib/remitos";
import { leerEntregasParciales, leerRemitos, leerTalonario, type Lectura, type VentaPorEntregar } from "@/lib/remitosDatos";

type Periodo = "mes" | "90" | "365" | "todo";
type Carga<T> = Lectura<T> | { estado: "cargando" };

function desdeDelPeriodo(p: Periodo, hoy: string): string | undefined {
  if (p === "todo") return undefined;
  if (p === "mes") return `${hoy.slice(0, 7)}-01`;
  const d = new Date(`${hoy}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (p === "90" ? 90 : 365));
  return d.toISOString().slice(0, 10);
}

export default function RemitosPage() {
  usePageTitle("Remitos");
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.id ?? null;
  const { isAdmin } = useUserRole();
  const permisos = useModulePermissions("sales");
  const puedeEmitir = permisos.canCreate;
  const puedeAnular = permisos.canDelete || isAdmin;
  const emisor = useEmisorDelRemito();
  const [params, setParams] = useSearchParams();
  const hoy = hoyAR();

  const [vista, setVista] = useState<"remitos" | "por-entregar">("remitos");
  const [periodo, setPeriodo] = useState<Periodo>("90");
  const [estado, setEstado] = useState<EstadoRemito | "todos">("todos");
  const [buscar, setBuscar] = useState("");
  const [remitos, setRemitos] = useState<Carga<Remito[]>>({ estado: "cargando" });
  const [talonario, setTalonario] = useState<Carga<Talonario | null>>({ estado: "cargando" });
  const [porEntregar, setPorEntregar] = useState<Carga<VentaPorEntregar[]>>({ estado: "cargando" });

  const [nuevo, setNuevo] = useState<{ venta: VentaParaRemito | null } | null>(null);
  const [detalle, setDetalle] = useState<Remito | null>(null);
  const [entregar, setEntregar] = useState<Remito | null>(null);
  const [anular, setAnular] = useState<Remito | null>(null);
  const talonarioAbierto = params.get("talonario") === "1";
  const abrirTalonario = (abrir: boolean) => {
    const p = new URLSearchParams(params);
    if (abrir) p.set("talonario", "1"); else p.delete("talonario");
    setParams(p, { replace: true });
  };

  const recargar = useCallback(async () => {
    if (!orgId) return;
    const [r, t, e] = await Promise.all([
      leerRemitos(orgId, { desde: desdeDelPeriodo(periodo, hoyAR()) }),
      leerTalonario(orgId),
      leerEntregasParciales(orgId),
    ]);
    setRemitos(r); setTalonario(t); setPorEntregar(e);
  }, [orgId, periodo]);

  useEffect(() => {
    setRemitos({ estado: "cargando" });
    void recargar();
  }, [recargar]);

  const lista = useMemo(() => (remitos.estado === "listo" ? remitos.datos : []), [remitos]);
  const filtrados = useMemo(() => {
    const q = normalizar(buscar);
    return lista.filter(r => (estado === "todos" || r.estado === estado) && (!q || normalizar([
      r.cliente_nombre, r.cliente_cuit ?? "", numeroDeRemito(r.punto_venta, r.numero), String(r.numero), r.transportista ?? "",
      ...r.remito_items.map(it => it.descripcion),
    ].join(" ")).includes(q)));
  }, [lista, estado, buscar]);

  const enCamino = lista.filter(r => r.estado === "emitido");
  const entregadosMes = lista.filter(r => r.estado === "entregado" && (r.entregado_at ?? "").slice(0, 7) === hoy.slice(0, 7)).length;
  const tal = talonario.estado === "listo" ? talonario.datos : null;
  const aviso = avisoDelCai(tal, hoy);
  const parciales = porEntregar.estado === "listo" ? porEntregar.datos : [];
  const ultimoPorPv = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of lista) m.set(r.punto_venta, Math.max(m.get(r.punto_venta) ?? 0, r.numero));
    return m;
  }, [lista]);

  const imprimir = (r: Remito) => {
    try { imprimirRemito(r, emisor); } catch (e) { toast.error(e instanceof Error ? e.message : "No se pudo abrir el remito."); }
  };
  const exportar = () => {
    descargarCsvContable(`remitos-${hoy}.csv`, remitosCsv(filtrados));
    toast.success(`${filtrados.length} ${filtrados.length === 1 ? "remito exportado" : "remitos exportados"}`);
  };
  const alTerminar = () => { setEntregar(null); setAnular(null); setDetalle(null); void recargar(); };

  const inactivo = remitos.estado === "inactivo" || talonario.estado === "inactivo";

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        icon={PackageCheck}
        title="Remitos"
        description="Qué entregaste, a quién y cuándo. Una venta se puede entregar en varios viajes: cada remito descuenta de lo pendiente."
        badge={enCamino.length > 0 ? { label: `${enCamino.length} en camino`, variant: "default" } : undefined}
        actions={!inactivo && (
          <div className="flex flex-wrap gap-2">
            {isAdmin && <Button variant="outline" onClick={() => abrirTalonario(true)}><Settings2 className="mr-2 h-4 w-4" />Talonario</Button>}
            {puedeEmitir && <Button onClick={() => setNuevo({ venta: null })}><Plus className="mr-2 h-4 w-4" />Remito sin venta</Button>}
          </div>
        )}
      />

      {inactivo ? (
        <WorkspaceState kind="partial" icon={PackageOpen} title="Los remitos todavía no están activos en tu cuenta"
          description="Se activan solos, sin que tengas que hacer nada. Mientras tanto, tus ventas y facturas funcionan como siempre." />
      ) : (
        <>
          {aviso && (
            <div role={aviso.tono === "error" ? "alert" : "status"} className={`flex items-start gap-3 rounded-lg border p-3 text-sm ${aviso.tono === "error" ? "border-destructive/30 bg-destructive/5 text-destructive" : "border-amber-500/30 bg-amber-500/5 text-amber-800 dark:text-amber-200"}`}>
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="flex-1">{aviso.texto}</p>
              {isAdmin && <Button size="sm" variant="outline" onClick={() => abrirTalonario(true)}>Cargar CAI</Button>}
            </div>
          )}

          <div data-tour="remitos-indicadores" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KPICard label="En camino" value={enCamino.length} icon={Truck} color="primary" sub="emitidos sin confirmar la entrega"
              onClick={() => { setVista("remitos"); setEstado("emitido"); }} />
            <KPICard label="Entregados este mes" value={entregadosMes} icon={CheckCircle2} color="success" sub="con firma de recepción" />
            <KPICard label="Entregas parciales" value={parciales.length} icon={PackageOpen} color={parciales.length ? "warning" : "success"}
              sub={parciales.length ? "ventas con mercadería por mandar" : "ninguna venta a medias"} onClick={() => setVista("por-entregar")} />
            <KPICard label="Próximo remito" value={talonario.estado === "listo" ? `${letraDelRemito(tal, hoy)} N.º ${tal?.proximo_numero ?? 1}` : "—"}
              icon={Settings2} color={letraDelRemito(tal, hoy) === "R" ? "success" : "warning"}
              sub={`Punto de venta ${tal?.punto_venta ?? 1} · ${tal?.cai ? `CAI vence ${fechaFiscalArgentina(tal.cai_vence)}` : "sin CAI"}`}
              onClick={isAdmin ? () => abrirTalonario(true) : undefined} />
          </div>

          <div data-tour="remitos-vistas">
          <WorkspaceViewTabs
            ariaLabel="Vistas de remitos"
            activeTab={vista}
            onChange={t => setVista(t as "remitos" | "por-entregar")}
            tabs={[
              { id: "remitos", label: "Remitos", icon: PackageCheck, count: remitos.estado === "listo" ? lista.length : undefined },
              { id: "por-entregar", label: "Por entregar", icon: PackageOpen, count: porEntregar.estado === "listo" ? parciales.length : undefined },
            ]}
          />
          </div>

          {vista === "remitos" ? (
            <section aria-label="Remitos emitidos" data-tour="remitos-lista" className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative flex-1 sm:max-w-sm">
                  <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input aria-label="Buscar remitos" className="pl-9" placeholder="Cliente, número o producto" value={buscar} onChange={e => setBuscar(e.target.value)} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Select value={estado} onValueChange={v => setEstado(v as EstadoRemito | "todos")}>
                    <SelectTrigger aria-label="Estado" className="h-10 w-48"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todos los estados</SelectItem>
                      <SelectItem value="emitido">En camino</SelectItem>
                      <SelectItem value="entregado">Entregados</SelectItem>
                      <SelectItem value="anulado">Anulados</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={periodo} onValueChange={v => setPeriodo(v as Periodo)}>
                    <SelectTrigger aria-label="Período" className="h-10 w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mes">Este mes</SelectItem>
                      <SelectItem value="90">Últimos 90 días</SelectItem>
                      <SelectItem value="365">Último año</SelectItem>
                      <SelectItem value="todo">Todos</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="outline" className="h-10" onClick={exportar} disabled={filtrados.length === 0}>
                    <FileSpreadsheet className="mr-2 h-4 w-4" />Excel
                  </Button>
                </div>
              </div>

              {remitos.estado === "cargando" && <TableSkeleton rows={5} />}
              {remitos.estado === "error" && (
                <WorkspaceState kind="error-recoverable" title="No pudimos leer los remitos" description={`${remitos.mensaje} Tus remitos están guardados; probá de nuevo.`}
                  actionLabel="Reintentar" onAction={() => { setRemitos({ estado: "cargando" }); void recargar(); }} />
              )}
              {remitos.estado === "listo" && lista.length === 0 && (
                <WorkspaceState kind="empty-first-use" icon={Truck} title="Todavía no emitiste remitos"
                  description="Abrí una venta en Ventas y tocá «Remito» para documentar la entrega, o emití uno sin venta para muestras y préstamos."
                  actionLabel={puedeEmitir ? "Remito sin venta" : undefined} onAction={puedeEmitir ? () => setNuevo({ venta: null }) : undefined} />
              )}
              {remitos.estado === "listo" && lista.length > 0 && filtrados.length === 0 && (
                <WorkspaceState kind="empty-filtered" title="Ningún remito coincide" description="Probá con otro estado, período o búsqueda."
                  actionLabel="Limpiar filtros" onAction={() => { setBuscar(""); setEstado("todos"); }} />
              )}
              {filtrados.length > 0 && (
                <>
                  <div className="hidden overflow-x-auto rounded-xl border border-border lg:block">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/30 text-left text-xs text-muted-foreground">
                          <th className="px-4 py-2.5 font-medium">Remito</th>
                          <th className="px-3 py-2.5 font-medium">Fecha</th>
                          <th className="px-3 py-2.5 font-medium">Cliente</th>
                          <th className="px-3 py-2.5 font-medium">Detalle</th>
                          <th className="px-3 py-2.5 font-medium">Estado</th>
                          <th className="px-3 py-2.5"><span className="sr-only">Acciones</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtrados.map(r => (
                          <tr key={r.id} className={`cursor-pointer border-b border-border/40 transition-colors last:border-0 hover:bg-muted/20 ${r.estado === "anulado" ? "text-muted-foreground" : ""}`}
                            onClick={() => setDetalle(r)}>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2.5">
                                <LetraDelRemito letra={r.letra} chica />
                                <span className={`font-mono text-[13px] ${r.estado === "anulado" ? "line-through" : "font-medium"}`}>{numeroDeRemito(r.punto_venta, r.numero)}</span>
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-3 py-3 text-xs">{fechaFiscalArgentina(r.fecha)}</td>
                            <td className="max-w-[14rem] px-3 py-3"><p className="truncate font-medium">{r.cliente_nombre}</p>{r.cliente_domicilio && <p className="truncate text-xs text-muted-foreground">{r.cliente_domicilio}</p>}</td>
                            <td className="max-w-[18rem] px-3 py-3 text-xs text-muted-foreground"><Resumen remito={r} /></td>
                            <td className="px-3 py-3"><EstadoDelRemito estado={r.estado} /></td>
                            <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                              <Acciones remito={r} puedeEntregar={puedeEmitir} puedeAnular={puedeAnular}
                                onImprimir={imprimir} onEntregar={setEntregar} onAnular={setAnular} onDetalle={setDetalle} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <ul className="space-y-2 lg:hidden">
                    {filtrados.map(r => (
                      <li key={r.id}>
                        <div className="flex gap-3 rounded-xl border border-border bg-card p-3">
                          <button type="button" className="flex min-w-0 flex-1 gap-3 text-left" onClick={() => setDetalle(r)}>
                            <LetraDelRemito letra={r.letra} chica />
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-2">
                                <span className="font-mono text-[13px] font-medium">{numeroDeRemito(r.punto_venta, r.numero)}</span>
                                <EstadoDelRemito estado={r.estado} />
                              </span>
                              <span className="mt-0.5 block truncate text-sm font-medium">{r.cliente_nombre}</span>
                              <span className="block text-xs text-muted-foreground">{fechaFiscalArgentina(r.fecha)} · <Resumen remito={r} /></span>
                            </span>
                          </button>
                          <Acciones remito={r} puedeEntregar={puedeEmitir} puedeAnular={puedeAnular}
                            onImprimir={imprimir} onEntregar={setEntregar} onAnular={setAnular} onDetalle={setDetalle} />
                        </div>
                      </li>
                    ))}
                  </ul>
                  {remitos.estado === "listo" && lista.length >= 500 && (
                    <p className="text-xs text-muted-foreground">Se muestran los 500 más recientes del período. Acotá el período para ver los anteriores.</p>
                  )}
                </>
              )}
            </section>
          ) : (
            <section aria-label="Ventas por entregar" className="space-y-3">
              <p className="text-sm text-muted-foreground">Ventas que ya tienen un remito y todavía no se entregaron completas. Las ventas de mostrador se entregan en el momento y no figuran acá.</p>
              {porEntregar.estado === "cargando" && <TableSkeleton rows={3} />}
              {porEntregar.estado === "error" && (
                <WorkspaceState kind="error-recoverable" title="No pudimos calcular lo pendiente" description={porEntregar.mensaje}
                  actionLabel="Reintentar" onAction={() => void recargar()} />
              )}
              {porEntregar.estado === "listo" && parciales.length === 0 && (
                <WorkspaceState kind="success" icon={PackageCheck} title="No hay entregas a medias" description="Todas las ventas con remito se entregaron completas." />
              )}
              {parciales.length > 0 && (
                <ul className="grid gap-3 lg:grid-cols-2">
                  {parciales.map(v => {
                    const pend = v.pendientes.filter(p => p.pendiente > 0);
                    return (
                      <li key={v.clave} className="flex flex-col rounded-xl border border-border bg-card p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate font-medium">{v.cliente || "Sin cliente"}</p>
                            <p className="text-xs text-muted-foreground">Venta <span className="font-mono">{v.codigo}</span>{v.fecha ? ` · ${fechaFiscalArgentina(v.fecha.slice(0, 10))}` : ""}</p>
                          </div>
                          <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-500/20 dark:text-amber-300">Entrega parcial</span>
                        </div>
                        <ul className="mt-3 flex-1 space-y-1 text-sm">
                          {pend.slice(0, 4).map(p => (
                            <li key={p.saleId} className="flex justify-between gap-3">
                              <span className="truncate">{p.descripcion}</span>
                              <span className="shrink-0 font-mono text-xs">faltan {cantidadLegible(p.pendiente)} <span className="text-muted-foreground">de {cantidadLegible(p.vendido - p.devuelto)}</span></span>
                            </li>
                          ))}
                          {pend.length > 4 && <li className="text-xs text-muted-foreground">y {pend.length - 4} productos más</li>}
                        </ul>
                        {puedeEmitir && (
                          <Button className="mt-4 self-start" size="sm" onClick={() => setNuevo({
                            venta: { saleTransactionId: v.saleTransactionId, codigo: v.codigo, clienteNombre: v.cliente, lineas: v.lineas },
                          })}>
                            <Truck className="mr-2 h-4 w-4" />Remitir lo pendiente
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}
        </>
      )}

      <EmitirRemitoDialog open={Boolean(nuevo)} onOpenChange={o => { if (!o) { setNuevo(null); void recargar(); } }}
        orgId={orgId} venta={nuevo?.venta ?? null} puedeConfigurar={isAdmin} />
      <DetalleDelRemito remito={detalle} emisor={emisor} puedeEntregar={puedeEmitir} puedeAnular={puedeAnular}
        onCerrar={() => setDetalle(null)} onImprimir={imprimir} onEntregar={setEntregar} onAnular={setAnular} />
      <EntregarRemitoDialog remito={entregar} onCerrar={() => setEntregar(null)} onListo={alTerminar} />
      <AnularRemitoDialog remito={anular} onCerrar={() => setAnular(null)} onListo={alTerminar} />
      <TalonarioDialog open={talonarioAbierto && isAdmin} orgId={orgId} talonario={tal} ultimoPorPuntoDeVenta={ultimoPorPv}
        onCerrar={() => abrirTalonario(false)} onListo={() => { abrirTalonario(false); void recargar(); }} />
    </div>
  );
}

function Resumen({ remito }: { remito: Remito }) {
  const [primero, ...resto] = remito.remito_items;
  if (!primero) return <>—</>;
  return <>{cantidadLegible(primero.cantidad)} {primero.unidad} {primero.descripcion}{resto.length ? ` y ${resto.length} más` : ""}</>;
}

function Acciones({ remito, puedeEntregar, puedeAnular, onImprimir, onEntregar, onAnular, onDetalle }: {
  remito: Remito; puedeEntregar: boolean; puedeAnular: boolean;
  onImprimir: (r: Remito) => void; onEntregar: (r: Remito) => void; onAnular: (r: Remito) => void; onDetalle: (r: Remito) => void;
}) {
  const numero = numeroDeRemito(remito.punto_venta, remito.numero);
  return (
    <div className="flex items-center justify-end gap-1">
      {puedeEntregar && remito.estado === "emitido" && (
        <Button size="sm" variant="outline" className="hidden h-8 lg:inline-flex" onClick={() => onEntregar(remito)}>
          <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />Entregado
        </Button>
      )}
      <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Imprimir remito ${numero}`} onClick={() => onImprimir(remito)}>
        <Printer className="h-4 w-4" />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Más acciones del remito ${numero}`}><MoreHorizontal className="h-4 w-4" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onDetalle(remito)}>Ver detalle</DropdownMenuItem>
          {puedeEntregar && remito.estado === "emitido" && <DropdownMenuItem onSelect={() => onEntregar(remito)}>Marcar entregado</DropdownMenuItem>}
          {puedeAnular && remito.estado !== "anulado" && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => onAnular(remito)}><Ban className="mr-2 h-3.5 w-3.5" />Anular</DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
