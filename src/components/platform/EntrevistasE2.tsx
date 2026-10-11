/**
 * Entrevistas del experimento E2 (docs/TESIS.md §9): registro y conteo contra
 * el criterio de éxito escrito antes de empezar. Sólo administradores de
 * plataforma (RLS de `entrevistas_e2`).
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isMissingRelation } from "@/lib/publicDataSource";
import { formatARS } from "@/lib/supabaseStore";
import { plural } from "@/lib/plural";
import {
  META_E2, PUERTAS, confirmaHipotesis, parsearHerramientas, resumirE2,
  type EntrevistaE2, type Puerta,
} from "@/lib/entrevistasE2";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { AlertTriangle, Loader2 } from "lucide-react";

const NOMBRE_PUERTA = Object.fromEntries(PUERTAS.map(p => [p.id, p.nombre])) as Record<Puerta, string>;
const ESTADO = {
  en_curso: { texto: "En curso", clase: "text-muted-foreground" },
  validada: { texto: "Hipótesis validada", clase: "text-emerald-600 dark:text-emerald-400" },
  refutada: { texto: "Hipótesis refutada: revisar la propuesta", clase: "text-destructive" },
};

const VACIO = { puerta: "catalogo_grande" as Puerta, comercio: "", rubro: "", herramientas: "", pago: "", margen: false, preguntas: "", notas: "" };

export default function EntrevistasE2() {
  const [filas, setFilas] = useState<EntrevistaE2[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sinTabla, setSinTabla] = useState(false);
  const [form, setForm] = useState(VACIO);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    const { data, error: queryError } = await supabase.from("entrevistas_e2" as never).select("*").order("fecha", { ascending: false });
    if (queryError) {
      if (isMissingRelation(queryError)) setSinTabla(true);
      else { console.error("entrevistas_e2", queryError); setError(queryError.message); }
      setFilas([]);
      return;
    }
    setFilas(((data ?? []) as EntrevistaE2[]).map(f => ({ ...f, pago_mensual_ars: f.pago_mensual_ars === null ? null : Number(f.pago_mensual_ars) })));
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  const guardar = async () => {
    if (!form.comercio.trim()) { toast.error("Escribí el nombre del comercio"); return; }
    const pago = form.pago.trim() === "" ? null : Number(form.pago.replace(/\./g, "").replace(",", "."));
    if (pago !== null && (!Number.isFinite(pago) || pago < 0)) { toast.error("Escribí lo que paga por mes en pesos, por ejemplo 45.000"); return; }
    setGuardando(true);
    const { error: insertError } = await supabase.from("entrevistas_e2" as never).insert({
      puerta: form.puerta,
      comercio: form.comercio.trim(),
      rubro: form.rubro.trim() || null,
      herramientas: parsearHerramientas(form.herramientas),
      pago_mensual_ars: pago,
      margen_sin_respuesta: form.margen,
      preguntas_sin_respuesta: form.preguntas.trim() || null,
      notas: form.notas.trim() || null,
    } as never);
    setGuardando(false);
    if (insertError) { console.error("entrevistas_e2 insert", insertError); toast.error(insertError.message || "No se pudo guardar"); return; }
    toast.success("Entrevista guardada");
    setForm({ ...VACIO, puerta: form.puerta });
    await cargar();
  };

  if (sinTabla) {
    return (
      <div className="flex items-start gap-3 border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <p>La base todavía no tiene <code>entrevistas_e2</code> (migración 20261010002600).</p>
      </div>
    );
  }
  if (error) return <p className="text-sm text-destructive">No se pudieron leer las entrevistas: {error}</p>;
  if (!filas) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando</p>;

  const r = resumirE2(filas);

  return (
    <div className="space-y-5">
      <div className="border border-border p-4 text-sm space-y-1">
        <p className="font-semibold">
          {plural(r.confirman, "entrevista")} de {r.total} confirman la hipótesis · meta: {META_E2.exitos} de {META_E2.entrevistas} antes del {new Date(`${META_E2.fecha}T12:00:00`).toLocaleDateString("es-AR")}
        </p>
        <p className={ESTADO[r.estado].clase}>{ESTADO[r.estado].texto}</p>
        <p className="text-muted-foreground">
          Confirma quien usa {META_E2.herramientas} o más herramientas y nombra el margen real como pregunta sin respuesta.
          {" "}Faltan: {PUERTAS.map(p => `${NOMBRE_PUERTA[p.id]} ${r.faltanPorPuerta[p.id]}`).join(" · ")}.
          {r.pagoMediano !== null && <> Pagan hoy (mediana): {formatARS(r.pagoMediano)} por mes.</>}
        </p>
      </div>

      <div className="border border-border p-4 space-y-3">
        <p className="text-sm font-semibold">Cargar entrevista</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="e2-puerta">Puerta</Label>
            <Select value={form.puerta} onValueChange={v => setForm({ ...form, puerta: v as Puerta })}>
              <SelectTrigger id="e2-puerta"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PUERTAS.map(p => <SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="e2-comercio">Comercio</Label>
            <Input id="e2-comercio" maxLength={120} value={form.comercio} onChange={ev => setForm({ ...form, comercio: ev.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="e2-rubro">Rubro</Label>
            <Input id="e2-rubro" maxLength={80} value={form.rubro} onChange={ev => setForm({ ...form, rubro: ev.target.value })} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="e2-herramientas">Herramientas que usa (separadas por coma)</Label>
            <Input id="e2-herramientas" placeholder="Excel, Tango, Tiendanube" value={form.herramientas} onChange={ev => setForm({ ...form, herramientas: ev.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="e2-pago">Cuánto paga por mes en total</Label>
            <Input id="e2-pago" inputMode="decimal" placeholder="$ por mes" value={form.pago} onChange={ev => setForm({ ...form, pago: ev.target.value })} />
          </div>
          <div className="space-y-1.5 sm:col-span-3">
            <Label htmlFor="e2-preguntas">Qué no puede responder hoy (en sus palabras)</Label>
            <Textarea id="e2-preguntas" maxLength={2000} rows={2} value={form.preguntas} onChange={ev => setForm({ ...form, preguntas: ev.target.value })} />
          </div>
          <div className="space-y-1.5 sm:col-span-3">
            <Label htmlFor="e2-notas">Notas</Label>
            <Textarea id="e2-notas" maxLength={4000} rows={2} value={form.notas} onChange={ev => setForm({ ...form, notas: ev.target.value })} />
          </div>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={form.margen} onCheckedChange={v => setForm({ ...form, margen: v === true })} />
          <span>Nombró el margen real (cuánto gana de verdad por venta, canal o campaña) como pregunta sin respuesta</span>
        </label>
        <Button onClick={() => void guardar()} disabled={guardando}>
          {guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Guardar entrevista
        </Button>
      </div>

      <div className="overflow-x-auto border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="px-3 py-2 text-left font-medium">Fecha</th>
              <th className="px-3 py-2 text-left font-medium">Comercio</th>
              <th className="px-3 py-2 text-left font-medium">Puerta</th>
              <th className="px-3 py-2 text-left font-medium">Herramientas</th>
              <th className="px-3 py-2 text-left font-medium">Confirma</th>
            </tr>
          </thead>
          <tbody>
            {filas.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">Todavía no hay entrevistas.</td></tr>}
            {filas.map(f => (
              <tr key={f.id} className="border-b border-border/50 last:border-0 align-top">
                <td className="px-3 py-2 whitespace-nowrap">{new Date(`${f.fecha}T12:00:00`).toLocaleDateString("es-AR")}</td>
                <td className="px-3 py-2 font-medium">{f.comercio}{f.rubro ? <span className="text-xs text-muted-foreground"> · {f.rubro}</span> : null}</td>
                <td className="px-3 py-2 text-xs">{NOMBRE_PUERTA[f.puerta]}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{f.herramientas.join(", ") || "—"}</td>
                <td className="px-3 py-2 text-xs">{confirmaHipotesis(f) ? "Sí" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
