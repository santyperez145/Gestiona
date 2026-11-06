/**
 * StockCountTab — ported from the former StockCountPage (/toma-fisica).
 * Rendered as the "Toma Física" tab inside KardexPage (/kardex).
 *
 * Physical-count / stock-adjustment workflow with barcode scanning.
 *
 * Desde 2026-11-05:
 *  - El conteo se abre en la base con el primer producto contado (ahí se
 *    congela lo esperado) y cada producto se registra a medida que se cuenta,
 *    con su hora: el cierre ajusta contra el stock de ese momento
 *    (20261105000900). Antes se abría y registraba todo recién al cerrar, y una
 *    venta hecha mientras se contaba volvía como sobrante.
 *  - El escáner cuenta desde cero (sumaba al stock del sistema), queda abierto
 *    entre lecturas, suena y vibra, y sólo acepta códigos exactos.
 *  - Se cuenta a ciegas por defecto: ver el stock del sistema sesga al que cuenta.
 */
import { lazy, memo, Suspense, useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useOrg } from "@/lib/orgContext";
import { useOrgCategoryNames } from "@/hooks/useOrgCategoryNames";
import { csvCell } from "@/lib/csv";
import { supabase } from "@/integrations/supabase/client";
import { fetchOrgProducts } from "@/lib/supabaseStore";
import { isMissingFunction } from "@/lib/publicDataSource";
import { clearStockCountDraft, loadStockCountDraft, saveStockCountDraft } from "@/lib/stockCountDraft";
import { registrarError } from "@/lib/registroDeErrores";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import KPICard from "@/components/shared/KPICard";
import { toast } from "sonner";
import {
  CheckCircle2, RefreshCw,
  Loader2, Download, Search, ChevronUp, ChevronDown,
  PackageCheck, TrendingDown, TrendingUp, Minus, ScanLine, Zap, Eye, EyeOff, Undo2, CloudOff, Cloud, Camera,
} from "lucide-react";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";
import { hoyAR } from "@/lib/fechaAR";
import { useEntitlements } from "@/lib/useEntitlements";
import { lectorDeCodigos } from "@/lib/lectorDeCodigos";

// La cámara de zona carga sólo al abrirla.
const ConteoPorZona = lazy(() => import("@/components/inventory/ConteoPorZona"));

// ─── Barcode scanner hook ─────────────────────────────────────────────────────

/** Una lectura del mismo código dentro de esta ventana es la misma etiqueta todavía enfocada. */
export const REPETICION_DEL_MISMO_CODIGO_MS = 1500;

/** Cada cuánto se mira el video buscando códigos (~7 por segundo). */
const INTERVALO_DE_LECTURA_MS = 140;

function useBarcodeScanner(onDetected: (code: string) => void) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const activo = useRef(false);
  const [scanning, setScanning] = useState(false);
  // El lector queda abierto entre lecturas: el callback se lee de una ref para
  // usar siempre el estado actual, no el del momento en que se abrió la cámara.
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;
  const ultimas = useRef(new Map<string, number>());

  const stop = useCallback(() => {
    activo.current = false;
    setScanning(false);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => stop, [stop]);

  const start = useCallback(async () => {
    try {
      setScanning(true);
      activo.current = true;
      // Lector nativo o ZXing-C++ en WebAssembly (lectorDeCodigos): el mismo
      // en Android, iPhone y escritorio.
      const [lector, stream] = await Promise.all([
        lectorDeCodigos(),
        navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        }),
      ]);
      if (!activo.current) { stream.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = stream;
      // El video del overlay aparece con `scanning`: se espera a que esté.
      for (let i = 0; i < 20 && !videoRef.current; i++) await new Promise(r => setTimeout(r, 25));
      const video = videoRef.current;
      if (!video) { stop(); return; }
      video.srcObject = stream;
      await video.play().catch(() => undefined);

      const leer = async () => {
        if (!activo.current) return;
        if (video.readyState >= 2) {
          try {
            for (const c of await lector.detect(video)) {
              const code = c.rawValue.trim();
              const ahora = Date.now();
              // La misma etiqueta todavía enfocada no se cuenta dos veces.
              if (!code || ahora - (ultimas.current.get(code) ?? 0) < REPETICION_DEL_MISMO_CODIGO_MS) continue;
              ultimas.current.set(code, ahora);
              onDetectedRef.current(code);
            }
          } catch {
            // Un cuadro que no se pudo leer no corta el escaneo.
          }
        }
        if (activo.current) setTimeout(() => { void leer(); }, INTERVALO_DE_LECTURA_MS);
      };
      void leer();
    } catch {
      stop();
      toast.error("No pudimos abrir la cámara. Revisá el permiso del navegador.");
    }
  }, [stop]);

  return { videoRef, scanning, start, stop };
}

/** Un pitido corto (y vibración en el teléfono): se cuenta sin mirar la pantalla. */
function avisarLectura(ok: boolean) {
  try {
    navigator.vibrate?.(ok ? 40 : [60, 60, 60]);
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = ok ? 1320 : 220;
    gain.gain.value = 0.08;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (ok ? 0.08 : 0.25));
    osc.onended = () => { void ctx.close(); };
  } catch {
    // Sin audio o vibración el conteo sigue igual.
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Product {
  id: string;
  name: string;
  category: string;
  /** Con un conteo abierto, lo esperado congelado al abrirlo. */
  stock: number;
  cost_usd: number;
  image_url?: string | null;
  barcode?: string | null;
  sku?: string | null;
}

interface CountRow {
  product: Product;
  counted: string; // text input — empty = not counted yet
}

type SortKey = "name" | "diff" | "system";

/** Lo leído por el escáner, para el código exacto del producto. */
export function productoDelCodigo<T extends { product: { barcode?: string | null; sku?: string | null; name: string } }>(
  rows: T[], code: string,
): T | null {
  const c = code.trim();
  if (!c) return null;
  return rows.find(r => r.product.barcode === c)
    ?? rows.find(r => r.product.sku === c)
    ?? rows.find(r => r.product.name.trim().toLowerCase() === c.toLowerCase())
    ?? null;
}

/**
 * Una diferencia que conviene recontar antes de ajustar: 3 unidades o más y
 * al menos el 20 % de lo esperado (contar 0 de algo que debería estar, también).
 */
export function esDiferenciaGrande(contado: number, esperado: number): boolean {
  const diferencia = Math.abs(contado - esperado);
  return diferencia >= Math.max(3, Math.ceil(Math.abs(esperado) * 0.2));
}

/** El escaneo cuenta desde cero: la primera lectura de un producto es 1 (× el multiplicador). */
export function contadoTrasEscanear(actual: string, multiplicador: number): string {
  const base = actual === "" ? 0 : Number(actual) || 0;
  return String(base + multiplicador);
}

// ─── Renglón ──────────────────────────────────────────────────────────────────

// Memorizado: con un catálogo de 5.500 productos, cada tecla redibujaba los
// 5.500 renglones con su campo. Así se redibuja sólo el que cambió.
const FilaConteo = memo(function FilaConteo({
  row, idx, categoria, isHighlighted, aCiegas, rowRefs, inputRefs, onCount, onEnter,
}: {
  row: CountRow;
  idx: number;
  categoria: string;
  isHighlighted: boolean;
  aCiegas: boolean;
  rowRefs: React.MutableRefObject<Record<string, HTMLTableRowElement | null>>;
  inputRefs: React.MutableRefObject<Record<string, HTMLInputElement | null>>;
  onCount: (id: string, value: string) => void;
  onEnter: (idx: number) => void;
}) {
  const counted = row.counted !== "" ? Number(row.counted) : null;
  const diff = !aCiegas && counted !== null ? counted - row.product.stock : null;
  const diffColor = diff === null
    ? ""
    : diff > 0
      ? "text-green-400"
      : diff < 0
        ? "text-red-400"
        : "text-muted-foreground";
  const rowBg = diff !== null && diff !== 0 ? (diff > 0 ? "bg-green-950/10" : "bg-red-950/10") : "";

  return (
    <tr
      ref={el => { rowRefs.current[row.product.id] = el; }}
      className={`border-b border-border/50 hover:bg-muted/20 transition-colors ${rowBg} ${isHighlighted ? "ring-2 ring-inset ring-primary/60 bg-primary/10" : ""}`}
    >
      <td className="px-4 py-2.5">
        <div className="font-medium">{row.product.name}</div>
        {!row.product.barcode && !row.product.sku && (
          <span className="text-[9px] text-muted-foreground/50 font-mono">sin código</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-muted-foreground hidden md:table-cell">
        {categoria}
      </td>
      <td className="px-3 py-2.5 text-right font-mono">{aCiegas ? <span className="text-muted-foreground/60">•••</span> : row.product.stock}</td>
      <td className="px-3 py-2.5 text-right">
        <Input
          ref={el => { inputRefs.current[row.product.id] = el; }}
          type="number"
          min={0}
          value={row.counted}
          onChange={e => onCount(row.product.id, e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") onEnter(idx); }}
          placeholder="—"
          aria-label={`Contado de ${row.product.name}`}
          className="w-20 h-7 text-right text-sm font-mono ml-auto"
        />
      </td>
      <td className={`px-3 py-2.5 text-right font-mono font-semibold ${diffColor}`}>
        {diff === null ? "—" : diff === 0 ? <span className="text-muted-foreground">±0</span> : (diff > 0 ? `+${diff}` : diff)}
      </td>
      <td className={`px-4 py-2.5 text-right hidden lg:table-cell ${diffColor}`}>
        {diff === null || diff === 0
          ? "—"
          : `${diff > 0 ? "+" : ""}${(diff * (row.product.cost_usd || 0)).toFixed(2)} USD`}
      </td>
    </tr>
  );
});

// ─── Tab ──────────────────────────────────────────────────────────────────────

const TANDA = 1000;

export default function StockCountTab() {
  const { activeOrg } = useOrg();
  const { ask, dialog } = useConfirmDialog();
  // El rotulo de cada categoria sale de las categorias de la organizacion.
  // Hasta 2026-08-25 salia de un Record con cuatro entradas de perfumeria, asi
  // que un comercio de otro rubro leia el slug crudo o el rubro equivocado.
  const { nombre: nombreCategoria } = useOrgCategoryNames(activeOrg?.id);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState<CountRow[]>([]);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [confirmedAt, setConfirmedAt] = useState<string | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [scanCount, setScanCount] = useState(0);
  /** Borrador recuperado tras recarga/corte: muestra banner para retomar. */
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  /** A ciegas: no se muestra lo que el sistema cree tener mientras se cuenta. */
  const [aCiegas, setACiegas] = useState(true);
  const [multiplicador, setMultiplicador] = useState(1);
  const [zonaAbierta, setZonaAbierta] = useState(false);
  /** Conteo cíclico (20261106000100): la lista corta de hoy. */
  const [ciclico, setCiclico] = useState<Array<{ product_id: string; nombre: string; clase: string; motivo: string }> | null>(null);
  const [soloCiclico, setSoloCiclico] = useState(false);
  const idsCiclico = useMemo(() => new Set((ciclico ?? []).map(c => c.product_id)), [ciclico]);
  /** Reconteo: los productos con diferencias grandes, antes de ajustar. */
  const [reconteo, setReconteo] = useState<Set<string> | null>(null);
  const reconfirmados = useRef(new Set<string>());
  /** Por qué faltó o sobró, al cerrar (20261106000200). */
  const [resumenCierre, setResumenCierre] = useState<Array<{ product_id: string; nombre: string; diferencia: number; valor: number; pistas: string[] }> | null>(null);
  const { canUseAI } = useEntitlements();
  const ultimaLectura = useRef<{ id: string; antes: string } | null>(null);
  const [puedeDeshacer, setPuedeDeshacer] = useState(false);

  // Conteo abierto en la base y lo que falta registrar en él.
  const conteoIdRef = useRef<string | null>(null);
  const [conteoAbierto, setConteoAbierto] = useState(false);
  const sucios = useRef(new Set<string>());
  const [sincronizacion, setSincronizacion] = useState<"al_dia" | "guardando" | "error">("al_dia");
  const registrando = useRef<Promise<void> | null>(null);
  /** Conteo en equipo: hasta dónde se trajo lo contado por otros y quiénes cuentan. */
  const ultimoTraido = useRef<string | null>(null);
  const [personasContando, setPersonasContando] = useState(0);
  const quienes = useRef(new Set<string>());

  const marcar = useCallback((id: string) => { sucios.current.add(id); }, []);

  // Barcode scan handler: código exacto (barras, SKU o nombre), cuenta desde cero.
  const handleBarcodeScan = useCallback((code: string) => {
    const found = productoDelCodigo(rowsRef.current, code);
    if (!found) {
      avisarLectura(false);
      toast.error(`Código "${code}" no encontrado`);
      return;
    }
    const id = found.product.id;
    ultimaLectura.current = { id, antes: found.counted };
    setPuedeDeshacer(true);
    const nuevo = contadoTrasEscanear(found.counted, multiplicador);
    setRows(prev => prev.map(r => r.product.id === id ? { ...r, counted: nuevo } : r));
    marcar(id);
    avisarLectura(true);
    setHighlightedId(id);
    setScanCount(n => n + 1);
    setTimeout(() => {
      rowRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedId(null);
    }, 150);
    toast.success(`${found.product.name}: ${nuevo}`, { id: "lectura-conteo" });
  }, [marcar, multiplicador]);

  const deshacerLectura = () => {
    const ultima = ultimaLectura.current;
    if (!ultima) return;
    setRows(prev => prev.map(r => r.product.id === ultima.id ? { ...r, counted: ultima.antes } : r));
    if (ultima.antes !== "") marcar(ultima.id);
    ultimaLectura.current = null;
    setPuedeDeshacer(false);
    setScanCount(n => Math.max(0, n - 1));
  };

  const { videoRef: scanVideoRef, scanning: scannerOpen, start: startScan, stop: stopScan } = useBarcodeScanner(handleBarcodeScan);

  // ── Conteo en la base ─────────────────────────────────────────────────────

  /** El conteo abierto de la organización (alcance total), si hay uno. */
  const buscarConteoAbierto = async (orgId: string): Promise<string | null> => {
    const { data, error } = await supabase
      .from("stock_counts")
      .select("id")
      .eq("org_id", orgId)
      .eq("status", "abierto")
      .is("location_id", null)
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) { registrarError(error); return null; }
    return (data as { id?: string } | null)?.id ?? null;
  };

  /** Abre el conteo con el primer producto contado: ahí se congela lo esperado. */
  const asegurarConteo = async (): Promise<string> => {
    if (conteoIdRef.current) return conteoIdRef.current;
    const { data: opened, error: openError } = await supabase.rpc("abrir_conteo", {
      p_org_id: activeOrg!.id,
      p_location_id: null,
      p_notes: `Toma física ${new Date().toLocaleDateString("es-AR")}`,
      p_solo_con_stock: false,
    });
    if (openError) {
      // Otro dispositivo lo abrió recién: se suma a ese.
      const existente = await buscarConteoAbierto(activeOrg!.id);
      if (!existente) throw openError;
      conteoIdRef.current = existente;
    } else {
      const payload = opened as { conteo_id?: unknown } | null;
      const id = typeof payload?.conteo_id === "string" ? payload.conteo_id : null;
      if (!id) throw new Error("La base no devolvió el identificador del conteo");
      conteoIdRef.current = id;
    }
    setConteoAbierto(true);
    return conteoIdRef.current!;
  };

  /**
   * Registra en la base lo contado que todavía no está. En tandas de 1.000
   * (20261023000500): de a uno eran 5.500 llamadas con el catálogo de Famatina.
   * Un producto que cambió mientras viajaba la tanda queda pendiente.
   */
  const registrarPendientes = useCallback(async (): Promise<void> => {
    if (registrando.current) { await registrando.current; }
    const ids = [...sucios.current];
    if (ids.length === 0 || !activeOrg) return;
    const porId = new Map(rowsRef.current.map(r => [r.product.id, r.counted]));
    const valido = (v: string) => v !== "" && Number.isFinite(Number(v)) && Number(v) >= 0;
    const enviados = ids
      .map(id => ({ id, valor: porId.get(id) ?? "" }))
      .filter(x => valido(x.valor));
    // Lo borrado o inválido (un negativo tipeado) no viaja ni queda pendiente.
    for (const id of ids) if (!valido(porId.get(id) ?? "")) sucios.current.delete(id);
    if (enviados.length === 0) return;

    const trabajo = (async () => {
      setSincronizacion("guardando");
      try {
        const countId = await asegurarConteo();
        let porTandas = true;
        for (let i = 0; porTandas && i < enviados.length; i += TANDA) {
          const tanda = enviados.slice(i, i + TANDA);
          const { error } = await supabase.rpc("registrar_conteo_lote" as never, {
            p_count_id: countId,
            p_items: tanda.map(x => ({ product_id: x.id, cantidad: Number(x.valor) })),
          } as never);
          if (error && i === 0 && isMissingFunction(error)) porTandas = false;
          else if (error) throw error;
          else for (const x of tanda) if ((rowsRef.current.find(r => r.product.id === x.id)?.counted ?? "") === x.valor) sucios.current.delete(x.id);
        }
        // Sin la migración: de a un producto, como antes.
        if (!porTandas) {
          for (const x of enviados) {
            const { error } = await supabase.rpc("registrar_conteo", {
              p_count_id: countId,
              p_product_id: x.id,
              p_cantidad: Number(x.valor),
            });
            if (error) throw error;
            if ((rowsRef.current.find(r => r.product.id === x.id)?.counted ?? "") === x.valor) sucios.current.delete(x.id);
          }
        }
        setSincronizacion(sucios.current.size ? "guardando" : "al_dia");
      } catch (error) {
        setSincronizacion("error");
        throw error;
      }
    })();
    registrando.current = trabajo;
    try { await trabajo; } finally { if (registrando.current === trabajo) registrando.current = null; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrg]);

  // ── Load ──────────────────────────────────────────────────────────────────

  const load = async () => {
    if (!activeOrg) return;
    setLoading(true);
    try {
      // El conteo físico tiene que listar todo el catálogo, no los primeros 1.000.
      const { data, error } = await fetchOrgProducts(activeOrg.id, "id,name,category,stock,cost_usd,image_url,barcode,sku");
      if (error) throw error;
      let productos = (data || []) as Product[];
      const draft = loadStockCountDraft(activeOrg.id);
      const delBorrador = new Map((draft?.rows ?? []).map(row => [row.product_id, row.counted]));
      const deLaBase = new Map<string, string>();
      sucios.current.clear();

      // Un conteo abierto (en este u otro dispositivo) se retoma: lo esperado es
      // lo congelado al abrirlo y lo contado viene de la base.
      const abierto = await buscarConteoAbierto(activeOrg.id);
      conteoIdRef.current = abierto;
      setConteoAbierto(Boolean(abierto));
      if (abierto) {
        const esperado = new Map<string, number>();
        quienes.current.clear();
        ultimoTraido.current = null;
        for (let desde = 0; ; desde += TANDA) {
          const { data: items, error: itemsError } = await supabase
            .from("stock_count_items")
            .select("product_id,expected,counted,counted_at,counted_by")
            .eq("count_id", abierto)
            .order("product_id")
            .range(desde, desde + TANDA - 1);
          if (itemsError) throw itemsError;
          for (const it of (items ?? []) as Array<{ product_id: string; expected: number; counted: number | null; counted_at: string | null; counted_by: string | null }>) {
            esperado.set(it.product_id, Number(it.expected));
            if (it.counted !== null) deLaBase.set(it.product_id, String(it.counted));
            if (it.counted_by) quienes.current.add(it.counted_by);
            if (it.counted_at && (!ultimoTraido.current || it.counted_at > ultimoTraido.current)) ultimoTraido.current = it.counted_at;
          }
          if ((items ?? []).length < TANDA) break;
        }
        // Sólo los productos del conteo: uno creado después no tiene esperado.
        productos = productos.filter(p => esperado.has(p.id)).map(p => ({ ...p, stock: esperado.get(p.id)! }));
      }
      setPersonasContando(quienes.current.size);

      let retomados = 0;
      const fresh: CountRow[] = productos.map(p => {
        const local = delBorrador.get(p.id);
        const remoto = deLaBase.get(p.id);
        if (local !== undefined && local !== "" && local !== remoto) { sucios.current.add(p.id); retomados++; return { product: p, counted: local }; }
        if (remoto !== undefined) { retomados++; return { product: p, counted: remoto }; }
        return { product: p, counted: "" };
      });
      setRows(fresh);

      // La lista del conteo cíclico. Si la base todavía no tiene la función,
      // la tarjeta no aparece; cualquier otro error queda registrado.
      const { data: deHoy, error: errCiclico } = await supabase.rpc("productos_para_conteo_ciclico" as never, {
        p_org_id: activeOrg.id, p_cantidad: 15,
      } as never);
      if (errCiclico) {
        if (!isMissingFunction(errCiclico)) registrarError(errCiclico);
        setCiclico(null);
      } else {
        setCiclico((deHoy ?? []) as Array<{ product_id: string; nombre: string; clase: string; motivo: string }>);
      }

      if (retomados > 0) {
        const cuando = draft ? new Date(draft.saved_at).toLocaleString("es-AR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "antes";
        setDraftNotice(`Retomamos tu conteo de ${cuando}: ${retomados} producto(s) con lo que ya habías contado.`);
      } else {
        setDraftNotice(null);
        setConfirmedAt(null);
      }
    } catch {
      toast.error("Error al cargar productos");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [activeOrg]);

  // Persistir el progreso local: cada cambio de campo guarda el borrador.
  // Con medio segundo de espera: serializar 5.500 renglones en cada tecla
  // trababa el campo. Al desmontar se graba lo pendiente. Lo contado además
  // se registra en la base cada un segundo y medio.
  const pendiente = useRef<{ orgId: string; rows: CountRow[] } | null>(null);
  useEffect(() => {
    if (loading || !activeOrg) return;
    pendiente.current = { orgId: activeOrg.id, rows };
    const t = setTimeout(() => {
      if (pendiente.current) saveStockCountDraft(pendiente.current.orgId, pendiente.current.rows);
      pendiente.current = null;
    }, 500);
    const r = setTimeout(() => {
      if (sucios.current.size && !saving) registrarPendientes().catch(error => registrarError(error));
    }, 1500);
    return () => { clearTimeout(t); clearTimeout(r); };
  }, [rows, loading, activeOrg, registrarPendientes, saving]);
  useEffect(() => () => {
    if (pendiente.current) saveStockCountDraft(pendiente.current.orgId, pendiente.current.rows);
  }, []);

  // Sin conexión: lo pendiente se reintenta al volver internet y cada 20
  // segundos, aunque nadie toque la pantalla.
  useEffect(() => {
    if (loading) return;
    const reintentar = () => {
      if (sucios.current.size && !saving) registrarPendientes().catch(error => registrarError(error));
    };
    window.addEventListener("online", reintentar);
    const id = window.setInterval(() => { if (sincronizacion === "error") reintentar(); }, 20_000);
    return () => { window.removeEventListener("online", reintentar); window.clearInterval(id); };
  }, [loading, saving, sincronizacion, registrarPendientes]);

  // Conteo en equipo: cada 15 segundos se trae lo que contaron otros equipos
  // en el mismo conteo. Lo que este equipo todavía no guardó no se pisa.
  useEffect(() => {
    if (!conteoAbierto || loading) return;
    let vivo = true;
    const traer = async () => {
      const countId = conteoIdRef.current;
      if (!countId || document.hidden) return;
      let consulta = supabase
        .from("stock_count_items")
        .select("product_id,counted,counted_at,counted_by")
        .eq("count_id", countId)
        .not("counted", "is", null)
        .order("counted_at", { ascending: true })
        .limit(TANDA);
      if (ultimoTraido.current) consulta = consulta.gt("counted_at", ultimoTraido.current);
      const { data, error } = await consulta;
      if (!vivo) return;
      if (error) { registrarError(error); return; }
      const nuevos = (data ?? []) as Array<{ product_id: string; counted: number; counted_at: string; counted_by: string | null }>;
      if (nuevos.length === 0) return;
      ultimoTraido.current = nuevos[nuevos.length - 1].counted_at;
      for (const it of nuevos) if (it.counted_by) quienes.current.add(it.counted_by);
      setPersonasContando(quienes.current.size);
      const porId = new Map(nuevos.map(it => [it.product_id, String(it.counted)]));
      setRows(prev => prev.map(r => {
        const remoto = porId.get(r.product.id);
        return remoto !== undefined && !sucios.current.has(r.product.id) && remoto !== r.counted ? { ...r, counted: remoto } : r;
      }));
    };
    const id = window.setInterval(() => { void traer(); }, 15_000);
    return () => { vivo = false; window.clearInterval(id); };
  }, [conteoAbierto, loading]);

  // ── Derived ───────────────────────────────────────────────────────────────

  const cats = useMemo(() => {
    const set = new Set(rows.map(r => r.product.category).filter(Boolean));
    return ["all", ...Array.from(set)];
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return rows
      .filter(r =>
        (!reconteo || reconteo.has(r.product.id)) &&
        (!soloCiclico || idsCiclico.has(r.product.id)) &&
        (catFilter === "all" || r.product.category === catFilter) &&
        (!q || r.product.name.toLowerCase().includes(q))
      )
      .sort((a, b) => {
        let av: number | string, bv: number | string;
        if (sortKey === "name" || aCiegas) { av = a.product.name; bv = b.product.name; }
        else if (sortKey === "system") { av = a.product.stock; bv = b.product.stock; }
        else {
          const aCount = a.counted !== "" ? Number(a.counted) : a.product.stock;
          const bCount = b.counted !== "" ? Number(b.counted) : b.product.stock;
          av = aCount - a.product.stock; bv = bCount - b.product.stock;
        }
        if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv as string, "es") : (bv as string).localeCompare(av, "es");
        return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
      });
  }, [rows, search, catFilter, sortKey, sortDir, aCiegas, soloCiclico, idsCiclico, reconteo]);

  const contadosDelDia = useMemo(
    () => rows.filter(r => idsCiclico.has(r.product.id) && r.counted !== "").length,
    [rows, idsCiclico],
  );

  const stats = useMemo(() => {
    let counted = 0, surplus = 0, shortage = 0, missing = 0, totalDiffCost = 0;
    rows.forEach(r => {
      if (r.counted === "") { missing++; return; }
      const diff = Number(r.counted) - r.product.stock;
      counted++;
      if (diff > 0) surplus++;
      else if (diff < 0) shortage++;
      totalDiffCost += diff * (r.product.cost_usd || 0);
    });
    return { counted, missing, surplus, shortage, totalDiffCost };
  }, [rows]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const setCount = useCallback((id: string, value: string) => {
    setRows(prev => prev.map(r => r.product.id === id ? { ...r, counted: value } : r));
    marcar(id);
  }, [marcar]);

  /** Lo contado en una zona se suma a lo que ya tenía el producto (desde cero). */
  const sumarDeZona = useCallback((id: string, unidades: number) => {
    setRows(prev => prev.map(r => r.product.id === id ? { ...r, counted: contadoTrasEscanear(r.counted, unidades) } : r));
    marcar(id);
    setScanCount(n => n + unidades);
  }, [marcar]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir(key === "diff" ? "asc" : "asc"); }
  };

  const handleConfirm = async () => {
    const countedRows = rows.filter(r => r.counted !== "");
    const changed = countedRows.filter(r => Number(r.counted) !== r.product.stock);
    if (countedRows.length === 0) { toast.info("Contá al menos un producto antes de cerrar"); return; }
    const invalido = countedRows.find(r => !Number.isFinite(Number(r.counted)) || Number(r.counted) < 0);
    if (invalido) { toast.error(`Revisá lo contado de ${invalido.product.name}: tiene que ser 0 o más.`); return; }
    // Las diferencias grandes casi siempre son errores de conteo: se ofrece
    // recontarlas antes de ajustar (una sola vez por producto).
    const grandes = countedRows.filter(r => !reconfirmados.current.has(r.product.id) && esDiferenciaGrande(Number(r.counted), r.product.stock));
    if (grandes.length > 0) {
      grandes.forEach(r => reconfirmados.current.add(r.product.id));
      if (await ask({
        title: `${grandes.length} producto${grandes.length !== 1 ? "s" : ""} con diferencias grandes`,
        description: "Antes de ajustar el stock conviene volver a contarlos: la mayoría de las diferencias grandes son errores de conteo.",
        confirmText: "Recontar ahora",
        cancelText: "Cerrar igual",
        variant: "default",
      })) {
        setReconteo(new Set(grandes.map(r => r.product.id)));
        setSoloCiclico(false);
        toast.info("Volvé a contar estos productos y corregí lo que haga falta. Después cerrá la toma.");
        return;
      }
    }
    if (!(await ask({
      title: "¿Cerrar toma física?",
      description: `Se registrarán ${changed.length} ajuste(s) auditado(s) sobre ${countedRows.length} producto(s) contado(s).`,
      confirmText: "Cerrar toma",
      variant: "destructive",
    }))) return;
    setSaving(true);
    try {
      // Todo lo contado tiene que estar en la base antes de cerrar.
      for (const id of countedRows.map(r => r.product.id)) if (!conteoIdRef.current) sucios.current.add(id);
      for (let vuelta = 0; vuelta < 5 && (vuelta === 0 || sucios.current.size > 0); vuelta++) await registrarPendientes();
      if (sucios.current.size > 0) throw new Error("No se pudo guardar todo lo contado. Reintentá el cierre.");
      const countId = await asegurarConteo();

      const { data: closed, error: closeError } = await supabase.rpc("cerrar_conteo", { p_count_id: countId });
      if (closeError) throw closeError;

      // Por qué faltó o sobró cada producto. Si la base todavía no tiene la
      // función, el cierre sigue igual sin el resumen.
      const { data: motivos, error: errMotivos } = await supabase.rpc("explicar_diferencias_de_conteo" as never, { p_count_id: countId } as never);
      if (errMotivos) {
        if (!isMissingFunction(errMotivos)) registrarError(errMotivos);
      } else {
        const lista = (Array.isArray(motivos) ? motivos : []) as Array<{ product_id: string; nombre: string; diferencia: number; valor: number; pistas: string[] }>;
        if (lista.length > 0) setResumenCierre(lista);
      }

      const closePayload = closed as { productos_ajustados?: unknown; sin_contar?: unknown } | null;
      const adjusted = typeof closePayload?.productos_ajustados === "number" ? closePayload.productos_ajustados : changed.length;
      const uncounted = typeof closePayload?.sin_contar === "number" ? closePayload.sin_contar : rows.length - countedRows.length;
      pendiente.current = null;
      conteoIdRef.current = null;
      setConteoAbierto(false);
      setReconteo(null);
      reconfirmados.current.clear();
      clearStockCountDraft(activeOrg!.id);
      setDraftNotice(null);
      await load();
      setConfirmedAt(new Date().toLocaleString("es-AR"));
      toast.success(`Toma cerrada: ${adjusted} ajustes auditados${uncounted ? `, ${uncounted} sin contar` : ""}`);
    } catch (error) {
      // El conteo NO se cancela: lo contado está en la base y se puede
      // reintentar el cierre (antes un error tiraba horas de conteo).
      toast.error(error instanceof Error ? error.message : "Error al cerrar la toma física. Lo contado quedó guardado: reintentá.");
    } finally {
      setSaving(false);
    }
  };

  /** Descarta la toma: cancela el conteo abierto y borra lo contado. */
  const descartarToma = async () => {
    if (!(await ask({
      title: "¿Descartar la toma?",
      description: "Se borra lo contado y el stock no cambia.",
      confirmText: "Descartar",
      variant: "destructive",
    }))) return;
    if (conteoIdRef.current) {
      const { error } = await supabase.rpc("cancelar_conteo", { p_count_id: conteoIdRef.current });
      if (error) { toast.error("No se pudo descartar la toma. Reintentá."); return; }
    }
    conteoIdRef.current = null;
    setConteoAbierto(false);
    sucios.current.clear();
    pendiente.current = null;
    clearStockCountDraft(activeOrg?.id);
    setScanCount(0);
    setDraftNotice(null);
    toast.info("Toma descartada: arranca desde cero.");
    await load();
  };

  const exportCSV = () => {
    const header = "Producto,Categoría,Sistema,Contado,Diferencia,Costo USD unitario,Impacto USD";
    const rowsData = rows.map(r => {
      const counted = r.counted !== "" ? Number(r.counted) : r.product.stock;
      const diff = counted - r.product.stock;
      // Cada celda va escapada: desde que el nombre de la categoria lo escribe
      // el comercio, uno con coma partia la fila y corria el resto del renglon.
      return [
        r.product.name,
        nombreCategoria(r.product.category),
        r.product.stock,
        r.counted !== "" ? r.counted : "(no contado)",
        diff,
        r.product.cost_usd || 0,
        (diff * (r.product.cost_usd || 0)).toFixed(2),
      ].map(csvCell).join(",");
    });
    const blob = new Blob([[header, ...rowsData].join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `toma-fisica-${hoyAR()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  // Focus next input on Enter
  const filteredRef = useRef(filtered);
  filteredRef.current = filtered;
  const focusNext = useCallback((idx: number) => {
    const nextId = filteredRef.current[idx + 1]?.product.id;
    if (nextId) inputRefs.current[nextId]?.focus();
  }, []);

  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey === k ? (sortDir === "asc" ? <ChevronUp className="w-3 h-3 inline" /> : <ChevronDown className="w-3 h-3 inline" />) : null;

  // ─── Render ───────────────────────────────────────────────────────────────

  const countedCount = rows.filter(r => r.counted !== "").length;

  return (
    <>
      {dialog}
    <div className="space-y-6 pb-12">
      <p className="text-sm text-muted-foreground">
        Contá lo que hay en el local, escaneando o escribiendo la cantidad. Lo contado se guarda solo; el stock cambia recién al cerrar la toma.
      </p>

      {/* Controls */}
      <div className="flex flex-col md:flex-row gap-3 items-start md:items-center">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar producto..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          {cats.map(c => (
            <Button
              key={c}
              variant={catFilter === c ? "default" : "outline"}
              size="sm"
              onClick={() => setCatFilter(c)}
              className="h-8 text-xs"
            >
              {c === "all" ? "Todo" : nombreCategoria(c)}
            </Button>
          ))}
        </div>
        <div className="flex gap-2 ml-auto flex-wrap">
          <Button variant="outline" size="sm" onClick={() => setACiegas(v => !v)} disabled={loading}>
            {aCiegas ? <Eye className="w-4 h-4 mr-1" /> : <EyeOff className="w-4 h-4 mr-1" />}
            {aCiegas ? "Ver diferencias" : "Contar a ciegas"}
          </Button>
          <Button variant="outline" size="sm" onClick={exportCSV} disabled={loading}>
            <Download className="w-4 h-4 mr-1" /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Recargar
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={startScan}
            disabled={loading || scannerOpen}
            className="gap-1 border-primary/40 text-primary hover:bg-primary/10"
          >
            <ScanLine className="w-4 h-4" />
            Escanear
            {scanCount > 0 && (
              <span className="ml-1 bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5 rounded-full font-bold">
                {scanCount}
              </span>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setZonaAbierta(true)}
            disabled={loading || scannerOpen}
            className="gap-1 border-primary/40 text-primary hover:bg-primary/10"
          >
            <Camera className="w-4 h-4" />
            Contar zona
          </Button>
          <Button
            size="sm"
            disabled={countedCount === 0 || saving}
            onClick={handleConfirm}
            className="gap-1"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackageCheck className="w-4 h-4" />}
            Cerrar toma ({countedCount})
          </Button>
        </div>
      </div>

      {reconteo && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm" role="status">
          <span className="flex-1 min-w-[16rem]">
            Reconteo: {reconteo.size} producto{reconteo.size !== 1 ? "s" : ""} con diferencias grandes. Contalos de nuevo y corregí lo que haga falta.
          </span>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setReconteo(null)}>
            Listo, ver todo
          </Button>
        </div>
      )}

      {/* Conteo cíclico: un poco todos los días, más seguido lo que más importa */}
      {!loading && ciclico && (
        <section className="rounded-xl border border-primary/25 bg-primary/5 p-4 space-y-3" aria-label="Conteo del día">
          {ciclico.length === 0 ? (
            <p className="text-sm text-foreground/90 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              Conteo del día al día: no hay productos que toque volver a contar hoy.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[14rem]">
                  <p className="text-sm font-medium">Conteo del día: {ciclico.length} producto{ciclico.length !== 1 ? "s" : ""} · unos {Math.max(2, Math.round(ciclico.length / 3))} minutos</p>
                  <p className="text-xs text-muted-foreground">
                    Contando un poco cada día, el stock no miente y nunca hace falta cerrar para inventariar.
                    {contadosDelDia > 0 && <> Llevás {contadosDelDia} de {ciclico.length}.</>}
                  </p>
                </div>
                <Button size="sm" variant={soloCiclico ? "outline" : "default"} onClick={() => setSoloCiclico(v => !v)}>
                  {soloCiclico ? "Ver todo el catálogo" : "Contar estos"}
                </Button>
              </div>
              <ul className="flex flex-wrap gap-1.5">
                {ciclico.map(c => (
                  <li key={c.product_id} title={c.motivo}
                    className="rounded-full border border-border bg-card px-2.5 py-1 text-xs">
                    <span className="font-semibold text-primary mr-1">{c.clase}</span>{c.nombre}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {/* Estado del guardado en la base */}
      {!loading && (conteoAbierto || countedCount > 0) && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" role="status">
          {sincronizacion === "error" ? (
            <><CloudOff className="w-3.5 h-3.5 text-destructive" /> Sin conexión: lo contado queda en este equipo y se guarda cuando vuelva.</>
          ) : sincronizacion === "guardando" ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Guardando lo contado…</>
          ) : (
            <><Cloud className="w-3.5 h-3.5 text-emerald-500" /> Lo contado está guardado. Podés seguir desde otro equipo.</>
          )}
          {personasContando > 1 && (
            <span className="rounded-full bg-primary/10 text-primary px-2 py-0.5 font-medium">
              Contando en equipo: {personasContando} personas
            </span>
          )}
          {conteoAbierto && (
            <Button variant="ghost" size="sm" className="h-7 text-xs ml-auto" onClick={() => { void descartarToma(); }} disabled={saving}>
              Descartar toma
            </Button>
          )}
        </div>
      )}

      {/* Stats strip */}
      {!loading && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <KPICard label="Contados" value={stats.counted} icon={CheckCircle2} color="success" />
          <KPICard label="Sin contar" value={stats.missing} icon={Minus} color="primary" />
          <KPICard label="Sobrantes" value={aCiegas ? "—" : stats.surplus} icon={TrendingUp} color="success" />
          <KPICard label="Faltantes" value={aCiegas ? "—" : stats.shortage} icon={TrendingDown} color="destructive" />
          <KPICard
            label="Impacto costo neto"
            value={aCiegas ? "—" : `${stats.totalDiffCost >= 0 ? "+" : ""}${stats.totalDiffCost.toFixed(0)} USD`}
            icon={stats.totalDiffCost < 0 ? TrendingDown : TrendingUp}
            color={stats.totalDiffCost < 0 ? "destructive" : "success"}
          />
        </div>
      )}

      {confirmedAt && (
        <div className="flex items-center gap-2 text-sm text-emerald-400 bg-emerald-950/30 border border-emerald-800/40 rounded-lg px-4 py-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          Toma confirmada el {confirmedAt}
        </div>
      )}

      {/* Borrador recuperado: horas de conteo no se pierden por recarga. */}
      {draftNotice && !loading && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm" role="status">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-primary" />
          <span className="flex-1 min-w-[16rem] text-foreground/90">{draftNotice}</span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => { void descartarToma(); }}
          >
            Descartar y empezar de nuevo
          </Button>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando productos...
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th
                  className="text-left px-4 py-2.5 font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground"
                  onClick={() => toggleSort("name")}
                >
                  Producto <SortIcon k="name" />
                </th>
                <th className="text-left px-3 py-2.5 font-medium text-muted-foreground hidden md:table-cell">Categoría</th>
                <th
                  className="text-right px-3 py-2.5 font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground"
                  onClick={() => toggleSort("system")}
                >
                  Sistema <SortIcon k="system" />
                </th>
                <th className="text-right px-3 py-2.5 font-medium text-muted-foreground">Contado</th>
                <th
                  className="text-right px-3 py-2.5 font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground"
                  onClick={() => toggleSort("diff")}
                >
                  Diferencia <SortIcon k="diff" />
                </th>
                <th className="text-right px-4 py-2.5 font-medium text-muted-foreground hidden lg:table-cell">Impacto USD</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-muted-foreground">
                    No se encontraron productos.
                  </td>
                </tr>
              )}
              {filtered.map((row, idx) => (
                <FilaConteo
                  key={row.product.id}
                  row={row}
                  idx={idx}
                  categoria={nombreCategoria(row.product.category)}
                  isHighlighted={highlightedId === row.product.id}
                  aCiegas={aCiegas}
                  rowRefs={rowRefs}
                  inputRefs={inputRefs}
                  onCount={setCount}
                  onEnter={focusNext}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      {!loading && (
        <p className="text-xs text-muted-foreground text-center">
          Presioná <kbd className="px-1 py-0.5 rounded border border-border text-xs">Enter</kbd> en cada campo para pasar al siguiente.
          El stock cambia recién al cerrar la toma.
        </p>
      )}

      {/* ── Por qué faltó o sobró ──────────────────────────────────────────── */}
      <Dialog open={!!resumenCierre} onOpenChange={abierto => { if (!abierto) setResumenCierre(null); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Por qué faltó o sobró</DialogTitle>
          </DialogHeader>
          {resumenCierre && (() => {
            const faltante = resumenCierre.filter(r => r.valor < 0).reduce((s, r) => s + Number(r.valor), 0);
            const sobrante = resumenCierre.filter(r => r.valor > 0).reduce((s, r) => s + Number(r.valor), 0);
            const pesos = (n: number) => `$ ${Math.abs(n).toLocaleString("es-AR", { maximumFractionDigits: 0 })}`;
            return (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Faltante a costo: <span className="font-semibold text-red-500">{pesos(faltante)}</span> ·
                  Sobrante: <span className="font-semibold text-emerald-600">{pesos(sobrante)}</span>.
                  Pistas cruzando los movimientos de los 60 días previos a contar.
                </p>
                <ul className="space-y-3">
                  {resumenCierre.slice(0, 20).map(r => (
                    <li key={r.product_id} className="rounded-lg border border-border p-3">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-medium">{r.nombre}</span>
                        <span className={`font-mono text-sm ${Number(r.diferencia) < 0 ? "text-red-500" : "text-emerald-600"}`}>
                          {Number(r.diferencia) > 0 ? "+" : ""}{Number(r.diferencia)} · {pesos(Number(r.valor))}
                        </span>
                      </div>
                      {r.pistas.length > 0 ? (
                        <ul className="mt-1.5 list-disc pl-5 text-sm text-muted-foreground space-y-0.5">
                          {r.pistas.map((p, i) => <li key={i}>{p}</li>)}
                        </ul>
                      ) : (
                        <p className="mt-1.5 text-sm text-muted-foreground">Sin una causa clara en los movimientos: vale la pena recontarlo la próxima vez.</p>
                      )}
                    </li>
                  ))}
                </ul>
                {resumenCierre.length > 20 && (
                  <p className="text-xs text-muted-foreground">Y {resumenCierre.length - 20} más con diferencias menores (están en el Kardex).</p>
                )}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* ── Conteo por zona: varios códigos a la vez e IA ─────────────────── */}
      {zonaAbierta && activeOrg && (
        <Suspense fallback={null}>
          <ConteoPorZona
            productos={rows.map(r => r.product)}
            candidatos={filtered.slice(0, 80).map(r => r.product)}
            canUseAI={canUseAI}
            orgId={activeOrg.id}
            onSumar={sumarDeZona}
            onCerrar={() => setZonaAbierta(false)}
          />
        </Suspense>
      )}

      {/* ── Scanner overlay ───────────────────────────────────────────────── */}
      {scannerOpen && (
        <div className="fixed inset-0 z-50 bg-black/85 flex flex-col items-center justify-center gap-4 px-4">
          <div className="relative w-full max-w-sm rounded-2xl overflow-hidden border-2 border-primary/60 shadow-2xl">
            <video ref={scanVideoRef} className="w-full aspect-video object-cover" autoPlay playsInline muted />
            {/* Animated scan line */}
            <div
              className="absolute left-0 right-0 h-0.5 bg-primary/80 shadow-[0_0_8px_2px_var(--primary)]"
              style={{ animation: "scanline 2s linear infinite", top: "50%" }}
            />
            {/* Corner brackets */}
            <div className="absolute inset-4 pointer-events-none">
              <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-primary rounded-tl-md" />
              <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-primary rounded-tr-md" />
              <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-primary rounded-bl-md" />
              <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-primary rounded-br-md" />
            </div>
          </div>
          <p className="text-white/70 text-sm flex items-center gap-2 text-center">
            <Zap className="w-4 h-4 text-primary animate-pulse shrink-0" />
            Pasá los productos uno por uno: cada lectura suma {multiplicador === 1 ? "una unidad" : `${multiplicador} unidades`}.
          </p>
          <div className="flex items-center gap-1.5" role="group" aria-label="Unidades por lectura">
            {[1, 6, 12, 24].map(n => (
              <Button
                key={n}
                size="sm"
                variant={multiplicador === n ? "default" : "outline"}
                className={multiplicador === n ? "h-9 min-w-11" : "h-9 min-w-11 border-white/30 text-white hover:bg-white/10"}
                onClick={() => setMultiplicador(n)}
              >
                ×{n}
              </Button>
            ))}
          </div>
          {scanCount > 0 && (
            <p className="text-primary font-semibold text-sm">{scanCount} lectura{scanCount !== 1 ? "s" : ""}</p>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={deshacerLectura} disabled={!puedeDeshacer} className="border-white/30 text-white hover:bg-white/10">
              <Undo2 className="w-4 h-4 mr-1" /> Deshacer la última
            </Button>
            <Button onClick={stopScan}>
              Listo
            </Button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes scanline {
          0%   { top: 20%; }
          50%  { top: 80%; }
          100% { top: 20%; }
        }
      `}</style>
    </div>
    </>
  );
}
