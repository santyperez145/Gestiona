import { useCallback, useEffect, useMemo, useState } from "react";
import { Layers3, Plus, SlidersHorizontal, Sparkles, X } from "lucide-react";
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
import {
  configureBusinessProfile,
  getOrganizationBusinessProfile,
  listBusinessProfilePresets,
  parseProductTypeTemplates,
  summarizeBusinessProfile,
  type BusinessProfilePreset,
  type OrganizationBusinessProfile,
} from "@/lib/businessProfile";

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
  canConfigureProfile?: boolean;
}

export default function ProductTypesManager({ orgId, open, onOpenChange, onChanged, canConfigureProfile = false }: ProductTypesManagerProps) {
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
  const [presets, setPresets] = useState<BusinessProfilePreset[]>([]);
  const [currentProfile, setCurrentProfile] = useState<OrganizationBusinessProfile | null>(null);
  const [selectedIndustryCode, setSelectedIndustryCode] = useState("");
  const [applyingProfile, setApplyingProfile] = useState(false);

  const selectedType = useMemo(() => types.find(type => type.id === selectedTypeId) || null, [types, selectedTypeId]);
  const selectedPreset = useMemo(
    () => presets.find(preset => preset.code === selectedIndustryCode) || null,
    [presets, selectedIndustryCode],
  );
  const selectedProfileSummary = useMemo(
    () => summarizeBusinessProfile(parseProductTypeTemplates(selectedPreset?.product_type_templates)),
    [selectedPreset],
  );
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

  const loadBusinessProfile = useCallback(async () => {
    try {
      const [nextPresets, nextProfile] = await Promise.all([
        listBusinessProfilePresets(),
        getOrganizationBusinessProfile(orgId),
      ]);
      setPresets(nextPresets);
      setCurrentProfile(nextProfile);
      setSelectedIndustryCode(current => (
        current && nextPresets.some(preset => preset.code === current)
          ? current
          : nextProfile?.industry_code || nextPresets[0]?.code || ""
      ));
    } catch (error: any) {
      toast.error(error?.message || "No se pudo cargar el perfil del negocio");
    }
  }, [orgId]);

  useEffect(() => {
    if (open) {
      void loadTypes();
      void loadBusinessProfile();
    }
  }, [open, loadTypes, loadBusinessProfile]);

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

  const applyBusinessProfile = async () => {
    if (!selectedIndustryCode) return;
    setApplyingProfile(true);
    try {
      const result = await configureBusinessProfile(orgId, selectedIndustryCode);
      await Promise.all([loadTypes(), loadBusinessProfile()]);
      onChanged?.();
      if (result.typesCreated || result.attributesCreated) {
        toast.success(`Perfil aplicado: ${result.typesCreated} tipos y ${result.attributesCreated} atributos nuevos`);
      } else if (result.customConflicts) {
        toast.info(`Perfil revisado. Se preservaron ${result.customConflicts} tipos creados por tu equipo.`);
      } else {
        toast.success("El perfil ya estaba actualizado; no se duplicó nada");
      }
    } catch (error: any) {
      toast.error(error?.message || "No se pudo aplicar el perfil del negocio");
    } finally {
      setApplyingProfile(false);
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
        <section className="rounded-lg border border-primary/25 bg-primary/[0.05] p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="max-w-xl">
              <p className="flex items-center gap-1.5 text-sm font-semibold"><Sparkles className="h-3.5 w-3.5 text-primary" /> Perfil inteligente del negocio</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Elegí el rubro y Gestiona prepara una estructura inicial sobre el catálogo único. Podés editarla: nunca borra tipos propios ni toca productos, precios o stock.
              </p>
              {currentProfile && (
                <p className="mt-2 text-[10px] font-medium uppercase tracking-wide text-primary/80">
                  Perfil actual: {presets.find(preset => preset.code === currentProfile.industry_code)?.name || currentProfile.industry_code} · versión {currentProfile.profile_version}
                </p>
              )}
            </div>
            <div className="w-full space-y-2 md:w-[250px]">
              <Select value={selectedIndustryCode} onValueChange={setSelectedIndustryCode}>
                <SelectTrigger className="bg-background"><SelectValue placeholder="Elegí un rubro" /></SelectTrigger>
                <SelectContent>{presets.map(preset => <SelectItem key={preset.code} value={preset.code}>{preset.name}</SelectItem>)}</SelectContent>
              </Select>
              <Button type="button" size="sm" className="w-full" onClick={applyBusinessProfile} disabled={applyingProfile || !selectedIndustryCode || !canConfigureProfile}>
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />{applyingProfile ? "Aplicando..." : "Aplicar estructura sugerida"}
              </Button>
              {!canConfigureProfile && <p className="text-[10px] text-muted-foreground">Sólo owner o admin puede cambiar el perfil.</p>}
            </div>
          </div>
          {selectedPreset && selectedProfileSummary.typeCount > 0 && (
            <div className="mt-3 rounded-md border border-border/60 bg-background/60 px-3 py-2 text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground/80">Antes de aplicar:</span> {selectedProfileSummary.typeNames.join(" · ")} · {selectedProfileSummary.attributeCount} atributos ({selectedProfileSummary.attributeNames.join(", ")}).
            </div>
          )}
        </section>
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
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <span className="truncate">{type.name}</span>
                    {type.source === "business_profile" && <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-primary">Perfil</span>}
                  </span>
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
