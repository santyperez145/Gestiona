import { useEffect, useRef, useState } from "react";
import { Loader2, Plus, Search, UserCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import CustomerFiscalFields from "@/components/customers/CustomerFiscalFields";
import { CONDICIONES_IVA, esCondicionIva, formatearCuit } from "@/lib/fiscalIdentity";
import { columnasIdentidadFiscal, errorIdentidadFiscal, IDENTIDAD_FISCAL_VACIA, letraParaCliente } from "@/lib/customerFiscal";

export type PosCustomer = {
  id: string;
  name: string;
  legal_name: string | null;
  tax_id: string | null;
  vat_condition: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  fiscal_address: string | null;
};

const COLUMNAS = "id, name, legal_name, tax_id, vat_condition, phone, email, address, fiscal_address";

/** Texto seguro para un filtro `or` de PostgREST: sin separadores ni comodines. */
export function terminoBusquedaCliente(q: string): string {
  return q.replace(/[,()*%\\]/g, " ").replace(/\s+/g, " ").trim();
}

export function etiquetaCliente(c: Pick<PosCustomer, "tax_id" | "vat_condition">): string {
  const condicion = esCondicionIva(c.vat_condition) ? CONDICIONES_IVA[c.vat_condition].label : "Consumidor Final";
  if (!c.tax_id) return condicion;
  return `${c.tax_id.length === 11 ? `CUIT ${formatearCuit(c.tax_id)}` : `DNI ${c.tax_id}`} · ${condicion}`;
}

/**
 * Buscar y elegir el cliente del ticket, o darlo de alta con sus datos
 * fiscales. La búsqueda va al servidor (nombre, razón social, documento o
 * teléfono) y trae 20 resultados: no carga toda la cartera en la caja.
 */
export default function PosCustomerPicker({ open, orgId, userId, emisor, onClose, onSelect }: {
  open: boolean;
  orgId: string | null | undefined;
  userId: string | null | undefined;
  emisor: string | null | undefined;
  onClose: () => void;
  onSelect: (customer: PosCustomer) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PosCustomer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftPhone, setDraftPhone] = useState("");
  const [fiscal, setFiscal] = useState(IDENTIDAD_FISCAL_VACIA);
  const request = useRef(0);

  useEffect(() => {
    if (!open) { setQuery(""); setCreating(false); setError(null); setFiscal(IDENTIDAD_FISCAL_VACIA); setDraftName(""); setDraftPhone(""); }
  }, [open]);

  useEffect(() => {
    if (!open || !orgId || creating) return;
    const id = ++request.current;
    const timer = setTimeout(async () => {
      setLoading(true); setError(null);
      const term = terminoBusquedaCliente(query);
      const digits = term.replace(/[^0-9]/g, "");
      let q = supabase.from("customers").select(COLUMNAS).eq("org_id", orgId).order("name").limit(20);
      if (term) {
        const filtros = [`name.ilike.*${term}*`, `legal_name.ilike.*${term}*`, `phone.ilike.*${term}*`];
        if (digits.length >= 3) filtros.push(`tax_id.like.*${digits}*`);
        q = q.or(filtros.join(","));
      }
      const { data, error: readError } = await q;
      if (id !== request.current) return;
      setLoading(false);
      if (readError) {
        console.error("[POS] búsqueda de clientes", readError);
        setError("No pudimos buscar clientes. Revisá la conexión y reintentá.");
        return;
      }
      setResults((data ?? []) as PosCustomer[]);
    }, 220);
    return () => clearTimeout(timer);
  }, [open, orgId, query, creating]);

  const fiscalError = errorIdentidadFiscal(fiscal);
  const create = async () => {
    if (!orgId || !userId || !draftName.trim() || fiscalError) return;
    setSaving(true); setError(null);
    const { data, error: insertError } = await supabase.from("customers")
      .insert({ org_id: orgId, user_id: userId, name: draftName.trim(), phone: draftPhone.trim() || null, ...columnasIdentidadFiscal(fiscal) })
      .select(COLUMNAS).single();
    setSaving(false);
    if (insertError || !data) {
      console.error("[POS] alta de cliente", insertError);
      setError(insertError?.code === "23514" ? "La base rechazó el documento: revisá CUIT/DNI y condición frente al IVA." : "No pudimos guardar el cliente. Reintentá.");
      return;
    }
    onSelect(data as PosCustomer);
  };

  return <Dialog open={open} onOpenChange={value => { if (!value) onClose(); }}>
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>{creating ? "Nuevo cliente" : "Elegir cliente"}</DialogTitle>
        <DialogDescription>{creating ? "Con CUIT y condición frente al IVA el ticket se factura a su nombre." : "Buscá por nombre, razón social, CUIT/DNI o teléfono."}</DialogDescription>
      </DialogHeader>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!creating ? <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Nombre, CUIT o teléfono" className="pl-8" aria-label="Buscar cliente" />
        </div>
        <ul className="max-h-72 divide-y divide-border overflow-y-auto" aria-busy={loading}>
          {loading && <li className="flex items-center gap-2 py-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Buscando…</li>}
          {!loading && results.map(c => <li key={c.id}>
            <button type="button" className="flex w-full items-center justify-between gap-3 py-2 text-left hover:bg-muted/50" onClick={() => onSelect(c)}>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{c.legal_name || c.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{etiquetaCliente(c)}{c.phone ? ` · ${c.phone}` : ""}</span>
              </span>
              <span className="shrink-0 rounded border border-border px-1.5 text-xs font-semibold" title="Comprobante que corresponde">Factura {letraParaCliente(emisor, c.vat_condition)}</span>
            </button>
          </li>)}
          {!loading && !results.length && !error && <li className="py-3 text-sm text-muted-foreground">{query.trim() ? "Ningún cliente coincide." : "Todavía no hay clientes cargados."}</li>}
        </ul>
      </div> : <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label htmlFor="pos-new-customer-name" className="text-xs text-muted-foreground">Nombre *</Label><Input id="pos-new-customer-name" autoFocus value={draftName} onChange={e => setDraftName(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="pos-new-customer-phone" className="text-xs text-muted-foreground">Teléfono</Label><Input id="pos-new-customer-phone" value={draftPhone} onChange={e => setDraftPhone(e.target.value)} /></div>
        </div>
        <CustomerFiscalFields value={fiscal} onChange={setFiscal} idPrefix="pos-new-customer" onPersona={p => setDraftName(n => n.trim() ? n : p.nombre)} />
        <p className="text-xs text-muted-foreground">Comprobante que corresponde: <strong>Factura {letraParaCliente(emisor, fiscal.vat_condition)}</strong></p>
      </div>}
      <DialogFooter className="gap-2">
        {creating
          ? <><Button variant="outline" onClick={() => setCreating(false)} disabled={saving}>Volver a buscar</Button>
            <Button onClick={() => void create()} disabled={saving || !draftName.trim() || !!fiscalError}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserCheck className="mr-2 h-4 w-4" />}Guardar y elegir</Button></>
          : <Button variant="outline" onClick={() => { setCreating(true); setDraftName(query.trim()); }}><Plus className="mr-2 h-4 w-4" />Nuevo cliente</Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
