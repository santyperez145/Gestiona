import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CONDICIONES_IVA, type CondicionIva } from "@/lib/fiscalIdentity";
import { errorIdentidadFiscal, type IdentidadFiscalCliente } from "@/lib/customerFiscal";
import { identidadDesdePadron, type PersonaPadron } from "@/lib/arcaPadron";
import { usePadronAutomatico } from "@/hooks/usePadronAutomatico";
import EstadoDelPadron from "@/components/afip/EstadoDelPadron";
import { cuitValido } from "../../../supabase/functions/_shared/padronA5";
import { useOrg } from "@/lib/orgContext";

/** Datos para facturar: condición frente al IVA, documento, razón social y domicilio fiscal. */
export default function CustomerFiscalFields({ value, onChange, idPrefix = "customer-fiscal", onPersona }: {
  value: IdentidadFiscalCliente;
  onChange: (next: IdentidadFiscalCliente) => void;
  idPrefix?: string;
  /** Lo que devolvió el padrón, para que el formulario complete el nombre si está vacío. */
  onPersona?: (persona: PersonaPadron) => void;
}) {
  const { activeOrg } = useOrg();
  const error = errorIdentidadFiscal(value);
  const cuit = value.tax_id.replace(/\D/g, "");
  // Al terminar de escribir un CUIT, ARCA completa razón social, condición y domicilio.
  const padron = usePadronAutomatico(activeOrg?.id, value.tax_id, persona => {
    onChange(identidadDesdePadron(value, persona));
    onPersona?.(persona);
  });
  const set = <K extends keyof IdentidadFiscalCliente>(key: K, v: IdentidadFiscalCliente[K]) => onChange({ ...value, [key]: v });
  return <fieldset className="space-y-3 border-t border-border pt-3">
    <legend className="text-xs font-semibold text-foreground">Datos de facturación</legend>
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-condicion`} className="text-xs text-muted-foreground">Condición frente al IVA</Label>
        <Select value={value.vat_condition} onValueChange={v => set("vat_condition", v as CondicionIva)}>
          <SelectTrigger id={`${idPrefix}-condicion`} className="bg-muted"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(CONDICIONES_IVA) as CondicionIva[]).map(c => <SelectItem key={c} value={c}>{CONDICIONES_IVA[c].label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-doc`} className="text-xs text-muted-foreground">CUIT o DNI {value.vat_condition !== "consumidor_final" && "*"}</Label>
        <Input id={`${idPrefix}-doc`} inputMode="numeric" value={value.tax_id} onChange={e => set("tax_id", e.target.value)}
          placeholder="20-12345678-6" className="bg-muted" aria-invalid={!!error} aria-describedby={error ? `${idPrefix}-doc-error` : undefined} />
        <EstadoDelPadron estado={padron.estado} onReintentar={padron.reintentar}
          cuitCompleto={cuit.length === 11 && cuitValido(cuit)} onConsultar={padron.reintentar} />
      </div>
    </div>
    {error && <p id={`${idPrefix}-doc-error`} className="text-xs text-destructive">{error}</p>}
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-razon`} className="text-xs text-muted-foreground">Razón social (si difiere del nombre)</Label>
        <Input id={`${idPrefix}-razon`} value={value.legal_name} onChange={e => set("legal_name", e.target.value)} placeholder="Ferretería Ejemplo SRL" className="bg-muted" />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-domicilio`} className="text-xs text-muted-foreground">Domicilio fiscal</Label>
        <Input id={`${idPrefix}-domicilio`} value={value.fiscal_address} onChange={e => set("fiscal_address", e.target.value)} placeholder="Calle, número, localidad" className="bg-muted" />
      </div>
    </div>
  </fieldset>;
}
