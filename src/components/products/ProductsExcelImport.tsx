import { useState, useRef, useMemo } from "react";
import { useOrg } from "@/lib/orgContext";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { calculateProductProfits } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Upload, FileSpreadsheet, CheckCircle2, AlertCircle,
  Loader2, X, Download, Info, Sparkles, ChevronDown, ChevronUp,
} from "lucide-react";

/**
 * Generic products Excel/CSV importer with automatic price calculations.
 *
 * Supports fuzzy column matching so customers can use whatever header
 * names they have. The computed fields (customs_fee, total_cost_usd,
 * profit_per_unit_*) are derived from cost_usd + sale_price_ars using
 * the org's exchange_rate and customs_percent from settings.
 */

const COL_ALIASES = {
  name: ["Nombre", "Name", "Producto", "Product", "Descripción", "Description", "Titulo", "Título"],
  brand: ["Marca", "Brand", "Fabricante", "Manufacturer"],
  category: ["Categoría", "Categoria", "Category", "Categorías", "Categorias", "Rubro", "Tipo"],
  gender: ["Género", "Genero", "Gender", "Sexo"],
  sku: ["SKU", "Código", "Codigo", "Code", "Ref", "Referencia"],
  barcode: ["Código de barras", "Codigo de barras", "Barcode", "EAN", "Codigo barras"],
  cost_usd: ["Costo USD", "Cost USD", "Precio costo USD", "Precio de costo USD", "Costo en USD", "Cost", "Costo"],
  sale_price_ars: [
    "Precio Venta ARS", "Precio venta", "Precio de venta", "Sale Price", "Price",
    "Precio ARS", "Precio", "PVP", "Precio Final",
  ],
  discount_price_ars: [
    "Precio Descuento", "Precio Oferta", "Precio promocional", "Discount Price",
    "Precio Promocional", "Promo", "Promocion",
  ],
  stock: ["Stock", "Cantidad", "Quantity", "Existencia", "Existencias"],
  content_ml: ["Contenido ml", "ML", "Volumen", "Volume", "Contenido", "Tamaño"],
  description: ["Descripción larga", "Descripcion", "Detalles", "Notes", "Observaciones"],
};

type ColumnKey = keyof typeof COL_ALIASES;

const CATEGORY_HINTS: Array<[RegExp, string]> = [
  [/perfum|fragran|eau de/i, "perfume_diseñador"],
  [/arab|oud|attar/i, "perfume_arabe"],
  [/vaper|vape|pod|cigarrillo elect/i, "vaper"],
  [/accesorio|accessory/i, "accesorio"],
  [/ropa|talle|indumentaria|prenda/i, "ropa"],
];

const GENDER_HINTS: Array<[RegExp, string]> = [
  [/femenin|mujer|woman|female|women/i, "femenino"],
  [/masculin|hombre|man|male|men/i, "masculino"],
  [/unisex|both/i, "unisex"],
];

function detectCategory(name: string, raw: string): string {
  const all = `${name} ${raw}`.toLowerCase();
  for (const [re, cat] of CATEGORY_HINTS) if (re.test(all)) return cat;
  return raw.trim().toLowerCase() || "otro";
}

function detectGender(raw: string, name: string): string {
  const all = `${name} ${raw}`;
  for (const [re, g] of GENDER_HINTS) if (re.test(all)) return g;
  return "unisex";
}

function parseNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (!v) return 0;
  const s = String(v).replace(/[$\s]/g, "").replace(/\./g, "").replace(/,/g, ".");
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

function resolveCol(row: Record<string, unknown>, key: ColumnKey): string {
  const aliases = COL_ALIASES[key];
  // First try exact alias match
  for (const a of aliases) {
    if (row[a] !== undefined && row[a] !== null && row[a] !== "") return String(row[a]).trim();
  }
  // Then try case-insensitive partial match
  const lowerAliases = aliases.map(a => a.toLowerCase());
  for (const k of Object.keys(row)) {
    const lk = k.toLowerCase();
    if (lowerAliases.some(a => lk === a || lk.includes(a))) {
      const val = row[k];
      if (val !== undefined && val !== null && val !== "") return String(val).trim();
    }
  }
  return "";
}

interface ParsedRow {
  name: string;
  brand: string;
  category: string;
  gender: string;
  sku: string;
  barcode: string;
  cost_usd: number;
  sale_price_ars: number;
  discount_price_ars: number | null;
  stock: number;
  content_ml: number | null;
  description: string;

  // Derived (computed in real-time)
  customs_fee: number;
  total_cost_usd: number;
  profit_per_unit_ars: number;
  profit_per_unit_usd: number;
  margin_pct: number;

  // Status
  action: "create" | "update";
  warning?: string;
}

export default function ProductsExcelImport({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const { activeOrg } = useOrg();
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);

  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exchangeRate, setExchangeRate] = useState<number>(1695);
  const [customsPercent, setCustomsPercent] = useState<number>(15);
  const [defaultMarginPct, setDefaultMarginPct] = useState<number>(80);
  const [autoFillSalePrice, setAutoFillSalePrice] = useState(true);
  const [expanded, setExpanded] = useState(false);

  // Load org settings to pre-fill defaults
  useMemo(() => {
    if (!activeOrg) return;
    supabase
      .from("settings")
      .select("exchange_rate, customs_percent")
      .eq("org_id", activeOrg.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.exchange_rate) setExchangeRate(Number(data.exchange_rate));
        if (data?.customs_percent) setCustomsPercent(Number(data.customs_percent));
      });
  }, [activeOrg]);

  // Re-compute derived fields whenever rates or rows change
  const computedRows = useMemo(() => {
    return rows.map((r) => {
      let salePriceARS = r.sale_price_ars;

      // Auto-fill sale price if missing
      if (autoFillSalePrice && salePriceARS <= 0 && r.cost_usd > 0) {
        const totalCostARS = r.cost_usd * (1 + customsPercent / 100) * exchangeRate;
        salePriceARS = Math.round(totalCostARS * (1 + defaultMarginPct / 100));
      }

      const calc = calculateProductProfits(r.cost_usd, customsPercent, salePriceARS, exchangeRate);
      const margin_pct = salePriceARS > 0 ? Math.round((calc.profitPerUnitARS / salePriceARS) * 100) : 0;

      let warning: string | undefined;
      if (!r.name) warning = "Sin nombre";
      else if (r.cost_usd <= 0) warning = "Sin costo USD";
      else if (salePriceARS <= 0) warning = "Sin precio venta";
      else if (margin_pct < 10) warning = "Margen muy bajo";
      else if (margin_pct < 0) warning = "Precio venta menor al costo";

      return {
        ...r,
        sale_price_ars: salePriceARS,
        customs_fee: calc.customsFee,
        total_cost_usd: calc.totalCostUSD,
        profit_per_unit_ars: calc.profitPerUnitARS,
        profit_per_unit_usd: calc.profitPerUnitUSD,
        margin_pct,
        warning,
      };
    });
  }, [rows, exchangeRate, customsPercent, defaultMarginPct, autoFillSalePrice]);

  const stats = useMemo(() => {
    const valid = computedRows.filter((r) => !r.warning).length;
    const warnings = computedRows.filter((r) => r.warning).length;
    const creates = computedRows.filter((r) => r.action === "create").length;
    const updates = computedRows.filter((r) => r.action === "update").length;
    const totalCostUSD = computedRows.reduce((s, r) => s + r.total_cost_usd * r.stock, 0);
    const totalRevenueARS = computedRows.reduce((s, r) => s + r.sale_price_ars * r.stock, 0);
    return { total: computedRows.length, valid, warnings, creates, updates, totalCostUSD, totalRevenueARS };
  }, [computedRows]);

  const handleFile = async (file: File) => {
    if (!activeOrg || !user) return;
    setParsing(true);
    setFileName(file.name);
    try {
      const { read, utils } = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw: Record<string, unknown>[] = utils.sheet_to_json(ws, { defval: "" });

      if (raw.length === 0) {
        toast.error("El archivo está vacío");
        setParsing(false);
        return;
      }

      // Check what SKUs/names already exist to determine action
      const skus = raw.map((r) => resolveCol(r, "sku")).filter(Boolean);
      const names = raw.map((r) => resolveCol(r, "name")).filter(Boolean);

      const { data: existing } = await supabase
        .from("products")
        .select("name, sku")
        .eq("org_id", activeOrg.id);

      const existingBySku = new Map((existing || []).filter((e) => e.sku).map((e) => [e.sku!.toLowerCase(), e]));
      const existingByName = new Map((existing || []).map((e) => [e.name.toLowerCase(), e]));

      const parsed: ParsedRow[] = raw
        .map((row) => {
          const name = resolveCol(row, "name");
          if (!name) return null;
          const brand = resolveCol(row, "brand") || "Sin marca";
          const categoryRaw = resolveCol(row, "category");
          const category = detectCategory(name, categoryRaw);
          const gender = detectGender(resolveCol(row, "gender"), name);
          const sku = resolveCol(row, "sku");
          const cost_usd = parseNum(resolveCol(row, "cost_usd"));
          const sale_price_ars = parseNum(resolveCol(row, "sale_price_ars"));
          const discount = parseNum(resolveCol(row, "discount_price_ars"));
          const stock = parseNum(resolveCol(row, "stock")) || 0;
          const content_ml = parseNum(resolveCol(row, "content_ml")) || null;

          const existsBySku = sku ? existingBySku.get(sku.toLowerCase()) : null;
          const existsByName = existingByName.get(name.toLowerCase());
          const action = existsBySku || existsByName ? "update" : "create";

          return {
            name,
            brand,
            category,
            gender,
            sku,
            barcode: resolveCol(row, "barcode"),
            cost_usd,
            sale_price_ars,
            discount_price_ars: discount > 0 ? discount : null,
            stock,
            content_ml,
            description: resolveCol(row, "description"),
            customs_fee: 0,
            total_cost_usd: 0,
            profit_per_unit_ars: 0,
            profit_per_unit_usd: 0,
            margin_pct: 0,
            action: action as "create" | "update",
          };
        })
        .filter((r): r is ParsedRow => r !== null);

      setRows(parsed);
      if (parsed.length === 0) {
        toast.error("No se encontraron productos válidos. Verificá que tu Excel tenga columnas como 'Nombre', 'Costo USD', 'Precio Venta'.");
      } else {
        toast.success(`${parsed.length} productos detectados`);
      }
    } catch (e) {
      console.error(e);
      toast.error("Error al leer el archivo. Verificá que sea .xlsx, .xls o .csv");
    }
    setParsing(false);
  };

  const handleImport = async () => {
    if (!activeOrg || !user) return;
    const validRows = computedRows.filter((r) => r.name && r.cost_usd > 0 && r.sale_price_ars > 0);
    if (validRows.length === 0) {
      toast.error("No hay productos válidos para importar");
      return;
    }

    setImporting(true);
    try {
      // Build the payload — only fields the products table accepts
      const payload = validRows.map((r) => ({
        org_id: activeOrg.id,
        user_id: user.id,
        name: r.name,
        brand: r.brand,
        category: r.category,
        gender: r.gender,
        sku: r.sku || null,
        barcode: r.barcode || null,
        description: r.description || null,
        cost_usd: r.cost_usd,
        customs_fee: r.customs_fee,
        total_cost_usd: r.total_cost_usd,
        sale_price_ars: r.sale_price_ars,
        discount_price_ars: r.discount_price_ars,
        profit_per_unit_ars: r.profit_per_unit_ars,
        profit_per_unit_usd: r.profit_per_unit_usd,
        stock: r.stock,
        content_ml: r.content_ml,
      }));

      // Upsert in batches (by name + org_id to update if it exists)
      let imported = 0;
      let updated = 0;
      let failed = 0;
      const BATCH = 50;
      for (let i = 0; i < payload.length; i += BATCH) {
        const batch = payload.slice(i, i + BATCH);
        // For each row, check if it exists and decide insert vs update
        for (const row of batch) {
          const matchKey = row.sku
            ? { sku: row.sku }
            : { name: row.name };
          const { data: existing } = await supabase
            .from("products")
            .select("id")
            .eq("org_id", activeOrg.id)
            .match(matchKey)
            .maybeSingle();

          if (existing) {
            const { error } = await supabase
              .from("products")
              .update(row)
              .eq("id", existing.id);
            if (error) failed++; else updated++;
          } else {
            const { error } = await supabase.from("products").insert(row);
            if (error) failed++; else imported++;
          }
        }
      }

      toast.success(
        `Importación completada: ${imported} creados, ${updated} actualizados${failed > 0 ? `, ${failed} fallidos` : ""}`,
      );
      onImported();
      onClose();
    } catch (e) {
      console.error(e);
      toast.error("Error en la importación. Revisá la consola para más detalles.");
    }
    setImporting(false);
  };

  const downloadTemplate = async () => {
    const { utils, writeFile } = await import("xlsx");
    const sampleData = [
      {
        Nombre: "Eau de Parfum Floral 100ml",
        Marca: "Marca Ejemplo",
        Categoría: "Perfume",
        Género: "Femenino",
        SKU: "EJM-001",
        "Código de barras": "7891234567890",
        "Costo USD": 25.50,
        "Precio Venta ARS": 65000,
        "Precio Descuento": 55000,
        Stock: 10,
        "Contenido ml": 100,
        Descripción: "Fragancia floral femenina con notas de jazmín",
      },
      {
        Nombre: "Vaper Frutas 5000 puffs",
        Marca: "VapeMax",
        Categoría: "Vaper",
        Género: "Unisex",
        SKU: "VAPE-001",
        "Código de barras": "",
        "Costo USD": 7.00,
        "Precio Venta ARS": "",
        "Precio Descuento": "",
        Stock: 25,
        "Contenido ml": "",
        Descripción: "",
      },
    ];
    const ws = utils.json_to_sheet(sampleData);
    ws["!cols"] = [
      { wch: 35 }, { wch: 18 }, { wch: 14 }, { wch: 10 }, { wch: 12 },
      { wch: 18 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 8 }, { wch: 12 }, { wch: 40 },
    ];
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, "Productos");
    writeFile(wb, "plantilla_productos.xlsx");
    toast.success("Plantilla descargada");
  };

  return (
    <div className="space-y-4 max-h-[85vh] overflow-y-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <FileSpreadsheet className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold">Importar productos desde Excel</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Subí tu archivo y Gestiona calcula <strong>automáticamente</strong> costos totales, márgenes y ganancias.
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="shrink-0">
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Calculation params (collapsible) */}
      <div className="border border-border rounded-lg overflow-hidden">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full px-4 py-2.5 flex items-center gap-2 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
        >
          <Sparkles className="w-3.5 h-3.5 text-primary" />
          <span className="text-sm font-medium flex-1">Parámetros de cálculo</span>
          <span className="text-xs text-muted-foreground hidden sm:inline">
            USD ${exchangeRate} · {customsPercent}% pasero · {defaultMarginPct}% margen
          </span>
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        {expanded && (
          <div className="p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Cotización USD → ARS</Label>
                <Input
                  type="number"
                  value={exchangeRate}
                  onChange={(e) => setExchangeRate(parseFloat(e.target.value) || 0)}
                  className="h-8 text-sm mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Pasero / impuestos (%)</Label>
                <Input
                  type="number"
                  value={customsPercent}
                  onChange={(e) => setCustomsPercent(parseFloat(e.target.value) || 0)}
                  className="h-8 text-sm mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Margen sugerido (%)</Label>
                <Input
                  type="number"
                  value={defaultMarginPct}
                  onChange={(e) => setDefaultMarginPct(parseFloat(e.target.value) || 0)}
                  className="h-8 text-sm mt-1"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={autoFillSalePrice}
                onChange={(e) => setAutoFillSalePrice(e.target.checked)}
                className="w-3.5 h-3.5"
              />
              <span>
                <strong>Auto-completar precio de venta</strong> si falta en el Excel (usa margen sugerido sobre costo)
              </span>
            </label>
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-blue-500/5 border border-blue-500/20">
              <Info className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                <strong>Cómo calculamos:</strong> Costo total USD = Costo + (Costo × Pasero%). Precio ARS sugerido = Costo total USD × Cotización × (1 + Margen%). Ganancia = Venta ARS − Costo total ARS.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Upload */}
      {rows.length === 0 ? (
        <div
          onClick={() => fileRef.current?.click()}
          className="border-2 border-dashed border-border rounded-xl p-8 text-center hover:border-primary/50 hover:bg-primary/5 transition cursor-pointer"
        >
          {parsing ? (
            <>
              <Loader2 className="w-8 h-8 mx-auto mb-3 text-primary animate-spin" />
              <p className="text-sm font-medium">Procesando archivo...</p>
            </>
          ) : (
            <>
              <Upload className="w-8 h-8 mx-auto mb-3 text-primary/60" />
              <p className="text-sm font-medium mb-1">Click para seleccionar un Excel</p>
              <p className="text-xs text-muted-foreground/60">.xlsx, .xls o .csv</p>
              <div className="mt-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    downloadTemplate();
                  }}
                >
                  <Download className="w-3.5 h-3.5 mr-1.5" /> Descargar plantilla
                </Button>
              </div>
            </>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
        </div>
      ) : (
        <>
          {/* File summary */}
          <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-muted/30 border border-border">
            <div className="flex items-center gap-3 min-w-0">
              <FileSpreadsheet className="w-5 h-5 text-primary shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{fileName}</p>
                <p className="text-xs text-muted-foreground">{stats.total} productos · {stats.creates} nuevos · {stats.updates} actualizar</p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setRows([]);
                setFileName(null);
                if (fileRef.current) fileRef.current.value = "";
              }}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="bg-card border border-border/60 rounded-lg p-2.5">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Válidos</p>
              <p className="text-lg font-bold text-green-400">{stats.valid}</p>
            </div>
            <div className="bg-card border border-border/60 rounded-lg p-2.5">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Con alertas</p>
              <p className="text-lg font-bold text-yellow-400">{stats.warnings}</p>
            </div>
            <div className="bg-card border border-border/60 rounded-lg p-2.5">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Inv. (USD)</p>
              <p className="text-sm font-mono font-bold">${Math.round(stats.totalCostUSD).toLocaleString("en")}</p>
            </div>
            <div className="bg-card border border-border/60 rounded-lg p-2.5">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Ventas pot.</p>
              <p className="text-sm font-mono font-bold">${Math.round(stats.totalRevenueARS).toLocaleString("es-AR")}</p>
            </div>
          </div>

          {/* Preview table — scrollable horizontally on mobile */}
          <div className="border border-border rounded-lg overflow-hidden">
            <p className="md:hidden text-[10px] text-muted-foreground italic px-3 py-1.5 bg-muted/20 border-b border-border">
              ← Deslizá horizontalmente para ver todas las columnas
            </p>
            <div className="overflow-x-auto max-h-[400px] table-wrap">
              <table className="w-full text-xs min-w-[700px]">
                <thead className="bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground sticky top-0">
                  <tr>
                    <th className="text-left px-2 py-2">Producto</th>
                    <th className="text-right px-2 py-2">Costo USD</th>
                    <th className="text-right px-2 py-2">Costo tot.</th>
                    <th className="text-right px-2 py-2">Venta ARS</th>
                    <th className="text-right px-2 py-2">Ganancia</th>
                    <th className="text-right px-2 py-2">Margen</th>
                    <th className="text-right px-2 py-2">Stock</th>
                    <th className="text-left px-2 py-2">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {computedRows.map((r, i) => (
                    <tr key={i} className={r.warning ? "bg-yellow-500/5" : "hover:bg-muted/20"}>
                      <td className="px-2 py-1.5">
                        <div className="font-medium truncate max-w-[200px]" title={r.name}>{r.name || "—"}</div>
                        <div className="text-[10px] text-muted-foreground">{r.brand} · {r.category}</div>
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">${r.cost_usd.toFixed(2)}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">${r.total_cost_usd.toFixed(2)}</td>
                      <td className="px-2 py-1.5 text-right font-mono">
                        ${r.sale_price_ars.toLocaleString("es-AR")}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">
                        ${Math.round(r.profit_per_unit_ars).toLocaleString("es-AR")}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <span className={
                          r.margin_pct < 0 ? "text-red-400"
                          : r.margin_pct < 15 ? "text-yellow-400"
                          : "text-green-400"
                        }>
                          {r.margin_pct}%
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right">{r.stock}</td>
                      <td className="px-2 py-1.5">
                        {r.warning ? (
                          <Badge variant="outline" className="text-[9px] h-4 px-1 border-yellow-500/30 text-yellow-400" title={r.warning}>
                            <AlertCircle className="w-2.5 h-2.5 mr-0.5" /> {r.warning}
                          </Badge>
                        ) : r.action === "update" ? (
                          <Badge variant="outline" className="text-[9px] h-4 px-1 border-blue-500/30 text-blue-400">Actualizar</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[9px] h-4 px-1 border-green-500/30 text-green-400">Crear</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center gap-2 justify-between sticky bottom-0 bg-background pt-3 border-t border-border/40">
            <p className="text-xs text-muted-foreground">
              {stats.warnings > 0 && `${stats.warnings} productos serán omitidos por errores. `}
              Solo se importarán los <strong className="text-foreground">{stats.valid}</strong> válidos.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose} disabled={importing}>Cancelar</Button>
              <Button onClick={handleImport} disabled={importing || stats.valid === 0}>
                {importing ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Importando...</>
                ) : (
                  <><CheckCircle2 className="w-4 h-4 mr-2" /> Importar {stats.valid} productos</>
                )}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
