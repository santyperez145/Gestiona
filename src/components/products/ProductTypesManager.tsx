import { useCallback, useEffect, useMemo, useState } from "react";
import { Layers3, Plus, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  createAttributeDefinition,
  createProductType,
  listAttributeDefinitions,
  listProductTypes,
  normalizeAttributeOptions,
  type AttributeDefinition,
  type ProductAttributeType,
  type ProductType,
} from "@/lib/productTypes";

const ATTRIBUTE_TYPES: Array<{ value: ProductAttributeType; label: string }> = [
  { value: "text", label: "Texto" },
  { value: "number", label: "Número" },
  { value: "boolean", label: "Sí / No" },
  { value: "date", label: "Fecha" },
  { value: "select", label: "Opción única" },
  { value: "multiselect", label: "Varias opciones" },
];

interface ProductTypesManagerProps {
  orgId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged?: () => void;
}

export default function ProductTypesManager({ orgId, open, onOpenChange, onChanged }: ProductTypesManagerProps) {
  const [types, setTypes] = useState<ProductType[]>([]);
  const [selectedTypeId, setSelectedTypeId] = useState("");
  const [attributes, setAttributes] = useState<AttributeDefinition[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newTypeName, setNewTypeName] = useState("");
  const [newTypeDescription, setNewTypeDescription] = useState("");
  const [attributeName, setAttributeName] = useState("");
  const [attributeType, setAttributeType] = useState<ProductAttributeType>("text");
  const [attributeUnit, setAttributeUnit] = useState("");
  const [attributeOptions, setAttributeOptions] = useState("");
  const [attributeRequired, setAttributeRequired] = useState(false);
  const [attributeFilterable, setAttributeFilterable] = useState(true);

  const selectedType = useMemo(() => types.find(type => type.id === selectedTypeId) || null, [types, selectedTypeId]);
  const needsOptions = attributeType === "select" || attributeType === "multiselect";

  const loadTypes = useCallback(async () => {
    setLoading(true);
    try {
      const nextTypes = await listProductTypes(orgId);
      setTypes(nextTypes);
      setSelectedTypeId(current => current && nextTypes.some(type => type.id === current) ? current : nextTypes[0]?.id || "");
    } catch (error: any) {
      toast.error(error?.message || "No se pudieron cargar los tipos de producto");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    if (open) void loadTypes();
  }, [open, loadTypes]);

  useEffect(() => {
    if (!selectedTypeId) {
      setAttributes([]);
      return;
    }
    listAttributeDefinitions(orgId, selectedTypeId)
      .then(setAttributes)
      .catch((error: any) => toast.error(error?.message || "No se pudieron cargar los atributos"));
  }, [orgId, selectedTypeId]);

  const addType = async () => {
    setSaving(true);
    try {
      const created = await createProductType(orgId, newTypeName, newTypeDescription);
      setNewTypeName("");
      setNewTypeDescription("");
      setTypes(current => [...current, created].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedTypeId(created.id);
      onChanged?.();
      toast.success("Tipo de producto creado");
    } catch (error: any) {
      toast.error(error?.message || "No se pudo crear el tipo");
    } finally {
      setSaving(false);
    }
  };

  const addAttribute = async () => {
    if (!selectedTypeId) {
      toast.error("Primero elegí un tipo de producto");
      return;
    }
    setSaving(true);
    try {
      const created = await createAttributeDefinition(orgId, selectedTypeId, {
        name: attributeName,
        data_type: attributeType,
        unit: attributeUnit,
        options: needsOptions ? normalizeAttributeOptions(attributeOptions.split(",")) : [],
        required: attributeRequired,
        filterable: attributeFilterable,
      });
      setAttributes(current => [...current, created].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)));
      setAttributeName("");
      setAttributeUnit("");
      setAttributeOptions("");
      setAttributeRequired(false);
      setAttributeFilterable(true);
      onChanged?.();
      toast.success("Atributo agregado");
    } catch (error: any) {
      toast.error(error?.message || "No se pudo crear el atributo");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            <Layers3 className="w-4 h-4 text-primary" /> Tipos y atributos
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <section className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
            <div>
              <p className="text-sm font-semibold">Tipos de producto</p>
              <p className="text-xs text-muted-foreground mt-1">La estructura que permite vender cualquier rubro sin nuevas columnas.</p>
            </div>
            <div className="space-y-1.5">
              {loading ? <p className="text-xs text-muted-foreground">Cargando tipos...</p> : types.length === 0 ? (
                <p className="text-xs text-muted-foreground py-3">Todavía no hay tipos configurados.</p>
              ) : types.map(type => (
                <button
                  key={type.id}
                  type="button"
                  onClick={() => setSelectedTypeId(type.id)}
                  className={`w-full text-left rounded-md border px-3 py-2 transition-colors ${selectedTypeId === type.id ? "border-primary/60 bg-primary/10" : "border-border hover:border-primary/40"}`}
                >
                  <span className="block text-sm font-medium">{type.name}</span>
                  <span className="block text-[11px] text-muted-foreground truncate">{type.description || type.slug}</span>
                </button>
              ))}
            </div>
            <div className="border-t border-border pt-3 space-y-2">
              <p className="text-xs font-semibold">Nuevo tipo</p>
              <Input value={newTypeName} onChange={event => setNewTypeName(event.target.value)} placeholder="Ej. Ferretería" className="bg-background" />
              <Textarea value={newTypeDescription} onChange={event => setNewTypeDescription(event.target.value)} placeholder="Qué representa este catálogo (opcional)" className="min-h-[64px] bg-background" />
              <Button type="button" size="sm" onClick={addType} disabled={saving || !newTypeName.trim()}>
                <Plus className="w-3.5 h-3.5 mr-1.5" /> Crear tipo
              </Button>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-muted/20 p-4 space-y-4">
            <div>
              <p className="text-sm font-semibold">Atributos de {selectedType?.name || "un tipo"}</p>
              <p className="text-xs text-muted-foreground mt-1">Los campos propios del rubro se guardan tipados y pueden filtrarse.</p>
            </div>
            {!selectedType ? <p className="text-xs text-muted-foreground py-6">Creá o seleccioná un tipo para agregar atributos.</p> : (
              <>
                <div className="space-y-2">
                  {attributes.length === 0 ? <p className="text-xs text-muted-foreground py-3">Sin atributos todavía.</p> : attributes.map(attribute => (
                    <div key={attribute.id} className="flex items-center gap-3 rounded-md border border-border bg-background px-3 py-2">
                      <SlidersHorizontal className="w-3.5 h-3.5 text-primary shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{attribute.name}{attribute.required ? <span className="text-primary ml-1">*</span> : null}</p>
                        <p className="text-[11px] text-muted-foreground">{ATTRIBUTE_TYPES.find(type => type.value === attribute.data_type)?.label}{attribute.unit ? ` · ${attribute.unit}` : ""}</p>
                      </div>
                      {attribute.filterable && <span className="text-[10px] text-muted-foreground">Filtro</span>}
                    </div>
                  ))}
                </div>
                <div className="border-t border-border pt-3 space-y-2">
                  <p className="text-xs font-semibold">Nuevo atributo</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input value={attributeName} onChange={event => setAttributeName(event.target.value)} placeholder="Ej. Diámetro" className="bg-background" />
                    <Select value={attributeType} onValueChange={value => setAttributeType(value as ProductAttributeType)}>
                      <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                      <SelectContent>{ATTRIBUTE_TYPES.map(type => <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input value={attributeUnit} onChange={event => setAttributeUnit(event.target.value)} placeholder="Unidad (cm, kg, V...)" className="bg-background" />
                    {needsOptions && <Input value={attributeOptions} onChange={event => setAttributeOptions(event.target.value)} placeholder="Opciones separadas por coma" className="bg-background" />}
                  </div>
                  <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                    <label className="inline-flex items-center gap-2"><input type="checkbox" checked={attributeRequired} onChange={event => setAttributeRequired(event.target.checked)} /> Obligatorio</label>
                    <label className="inline-flex items-center gap-2"><input type="checkbox" checked={attributeFilterable} onChange={event => setAttributeFilterable(event.target.checked)} /> Usar como filtro</label>
                  </div>
                  <Button type="button" size="sm" onClick={addAttribute} disabled={saving || !attributeName.trim() || (needsOptions && !attributeOptions.trim())}>
                    <Plus className="w-3.5 h-3.5 mr-1.5" /> Agregar atributo
                  </Button>
                </div>
              </>
            )}
          </section>
        </div>
        <div className="flex items-center justify-between border-t border-border pt-3">
          <p className="text-[11px] text-muted-foreground">Los productos existentes siguen usando su categoría y `custom_fields` hasta que se les asigne un tipo.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}><X className="w-3.5 h-3.5 mr-1.5" />Cerrar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
