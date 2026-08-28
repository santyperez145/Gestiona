import { useState, useRef } from "react";
import { useOrg } from "@/lib/orgContext";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import FilePicker from "@/components/shared/FilePicker";
import { toast } from "sonner";
import { plural } from "@/lib/plural";
import {
  Upload, FileSpreadsheet, CheckCircle2, AlertCircle,
  Loader2, X, ChevronDown, ChevronUp, Info,
} from "lucide-react";

// Column name aliases — Tiendanube exports in Spanish; handle common variations
const COL = {
  handle:       ["Identificador URL", "Handle", "URL"],
  name:         ["Nombre", "Name", "Título"],
  category:     ["Categorías", "Categories", "Categorias"],
  description:  ["Descripción", "Description"],
  brand:        ["Marca", "Brand"],
  sku:          ["SKU"],
  barcode:      ["Código de barras", "Barcode", "Codigo de barras"],
  prop1name:    ["Nombre de propiedad 1", "Property 1 Name", "Propiedad 1"],
  prop1vals:    ["Valores de propiedad 1", "Property 1 Values", "Valores 1"],
  prop2name:    ["Nombre de propiedad 2", "Property 2 Name", "Propiedad 2"],
  prop2vals:    ["Valores de propiedad 2", "Property 2 Values", "Valores 2"],
  prop3name:    ["Nombre de propiedad 3", "Property 3 Name", "Propiedad 3"],
  prop3vals:    ["Valores de propiedad 3", "Property 3 Values", "Valores 3"],
  price:        ["Precio", "Price"],
  promoPrice:   ["Precio promocional", "Promotional price", "Precio Promocional"],
  stock:        ["Stock", "Cantidad", "Quantity"],
  cost:         ["Precio de costo", "Cost", "Costo"],
  published:    ["Mostrar en la tienda", "Show in store", "Publicado"],
};

type ProductRow = {
  handle: string;
  name: string;
  brand: string;
  category: string;
  description: string;
  sku: string;
  barcode: string;
  price: number;
  stock: number;
  prop1name: string; prop1vals: string;
  prop2name: string; prop2vals: string;
  prop3name: string; prop3vals: string;
};

type ParsedProduct = {
  name: string;
  brand: string;
  category: string;
  description: string;
  sku: string;
  barcode: string;
  price: number;
  stock: number;
  variants: { name: string; variantType: string; stock: number; sku: string; barcode: string }[];
};

function mapCategory(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes("perfum") || s.includes("fragran")) return "perfume_diseñador";
  if (s.includes("arab") || s.includes("oud")) return "perfume_arabe";
  if (s.includes("vaper") || s.includes("vaporizador")) return "vaper";
  if (s.includes("accesorio")) return "accesorio";
  if (s.includes("ropa") || s.includes("talle") || s.includes("indumentaria")) return "ropa";
  // Sin coincidencia gana la categoria que trae el archivo, no un rubro que
  // elige el codigo: quien exporta de Tiendanube ya tiene su propia taxonomia
  // y aplastarla contra "otro" le borra el trabajo. Espejo de
  // detectImportCategory en productImport.ts, que resuelve lo mismo asi.
  return raw.trim().toLowerCase() || "otro";
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function resolve(row: Record<string, string>, aliases: string[]): string {
  for (const a of aliases) {
    if (row[a] !== undefined && row[a] !== null && row[a] !== "") return String(row[a]).trim();
  }
  return "";
}

function parseRows(rows: Record<string, string>[]): ParsedProduct[] {
  const grouped: Record<string, ProductRow[]> = {};

  for (const raw of rows) {
    const handle = resolve(raw, COL.handle) || resolve(raw, COL.name) || String(Math.random());
    if (!grouped[handle]) grouped[handle] = [];
    grouped[handle].push({
      handle,
      name:        resolve(raw, COL.name),
      brand:       resolve(raw, COL.brand),
      category:    resolve(raw, COL.category),
      description: resolve(raw, COL.description),
      sku:         resolve(raw, COL.sku),
      barcode:     resolve(raw, COL.barcode),
      price:       parseFloat(resolve(raw, COL.price).replace(",", ".")) || 0,
      stock:       parseInt(resolve(raw, COL.stock)) || 0,
      prop1name:   resolve(raw, COL.prop1name),
      prop1vals:   resolve(raw, COL.prop1vals),
      prop2name:   resolve(raw, COL.prop2name),
      prop2vals:   resolve(raw, COL.prop2vals),
      prop3name:   resolve(raw, COL.prop3name),
      prop3vals:   resolve(raw, COL.prop3vals),
    });
  }

  const products: ParsedProduct[] = [];

  for (const [, rowGroup] of Object.entries(grouped)) {
    const first = rowGroup[0];
    const hasVariants = rowGroup.some(r => r.prop1name || r.prop1vals);

    if (!hasVariants) {
      // Single product, no variants
      products.push({
        name: first.name || "Sin nombre",
        brand: first.brand,
        category: mapCategory(first.category),
        description: stripHtml(first.description),
        sku: first.sku,
        barcode: first.barcode,
        price: first.price,
        stock: first.stock,
        variants: [],
      });
    } else {
      // Product with variants (one row per variant)
      const variantType = first.prop1name || "variante";
      const totalStock = rowGroup.reduce((s, r) => s + r.stock, 0);
      const variants = rowGroup
        .map(r => {
          const parts = [r.prop1vals, r.prop2vals, r.prop3vals].filter(Boolean);
          return {
            name: parts.join(" / "),
            variantType: variantType.toLowerCase(),
            stock: r.stock,
            sku: r.sku,
            barcode: r.barcode,
          };
        })
        .filter(v => v.name);

      products.push({
        name: first.name || "Sin nombre",
        brand: first.brand,
        category: mapCategory(first.category),
        description: stripHtml(first.description),
        sku: first.sku,
        barcode: first.barcode,
        price: first.price,
        stock: totalStock,
        variants,
      });
    }
  }

  return products;
}

export default function TiendanubeExcelImport() {
  const { activeOrg } = useOrg();
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedProduct[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState<{ products: number; variants: number } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [parseError, setParseError] = useState("");

  const handleFile = async (file: File) => {
    setFileName(file.name);
    setParsed(null);
    setDone(null);
    setParseError("");

    try {
      const { read, utils } = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const wb = read(buffer, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: Record<string, string>[] = utils.sheet_to_json(ws, { defval: "" });

      if (rows.length === 0) {
        setParseError("El archivo no tiene filas de datos.");
        return;
      }

      const products = parseRows(rows);
      if (products.length === 0) {
        setParseError("No se encontraron productos válidos. Verificá que el archivo tenga columnas 'Nombre' y 'Precio'.");
        return;
      }
      setParsed(products);
    } catch (e: any) {
      setParseError("Error al leer el archivo: " + (e?.message || "formato no soportado"));
    }
  };

  const handleImport = async () => {
    if (!parsed || !activeOrg || !user) return;
    setImporting(true);
    let productsImported = 0;
    let variantsImported = 0;

    try {
      for (const p of parsed) {
        const { data: product, error } = await supabase
          .from("products")
          .upsert({
            org_id: activeOrg.id,
            user_id: user.id,
            name: p.name,
            brand: p.brand,
            category: p.category,
            description: p.description || null,
            sale_price_ars: p.price,
            cost_price_usd: 0,
            stock: p.variants.length > 0 ? p.variants.reduce((s, v) => s + v.stock, 0) : p.stock,
            sku: p.sku || null,
            barcode: p.barcode || null,
          }, {
            onConflict: "org_id,sku",
            ignoreDuplicates: false,
          })
          .select("id")
          .maybeSingle();

        if (error || !product) continue;
        productsImported++;

        for (const v of p.variants) {
          if (!v.name) continue;
          const { error: vErr } = await supabase
            .from("product_variants")
            .upsert({
              org_id: activeOrg.id,
              product_id: product.id,
              user_id: user.id,
              variant_name: v.name,
              variant_type: v.variantType,
              stock: v.stock,
              sku: v.sku || null,
              barcode: v.barcode || null,
              active: true,
            }, { onConflict: "product_id,variant_name", ignoreDuplicates: false });

          if (!vErr) variantsImported++;
        }
      }

      setDone({ products: productsImported, variants: variantsImported });
      toast.success(`Importados: ${plural(productsImported, "producto")}, ${variantsImported} variantes`);
      setParsed(null);
      setFileName("");
    } catch (e: any) {
      toast.error("Error durante la importación: " + e.message);
    } finally {
      setImporting(false);
    }
  };

  const reset = () => {
    setParsed(null);
    setFileName("");
    setDone(null);
    setParseError("");
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        className="w-full px-5 py-4 flex items-center justify-between gap-3 hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
            <FileSpreadsheet className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-left">
            <p className="text-sm font-medium">Importar desde Excel de Tiendanube</p>
            <p className="text-xs text-muted-foreground">Subí el archivo .xlsx o .csv exportado desde tu panel de Tiendanube</p>
          </div>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="px-5 pb-5 border-t border-border space-y-4 pt-4">
          {/* How-to note */}
          <div className="flex gap-2 p-3 rounded-lg bg-blue-500/5 border border-blue-500/15">
            <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
            <p className="text-xs text-blue-300/80 leading-relaxed">
              En Tiendanube: <strong>Productos → Importar/Exportar → Exportar productos</strong>. Descargá el Excel, luego subilo acá. Se importarán nombre, marca, precio, stock, SKU, código de barras y variantes.
            </p>
          </div>

          {done ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <CheckCircle2 className="w-10 h-10 text-emerald-400" />
              <p className="font-semibold">Importación completada</p>
              <div className="flex gap-3">
                <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/20">{done.products} productos</Badge>
                <Badge className="bg-primary/15 text-primary border-primary/20">{done.variants} variantes</Badge>
              </div>
              <Button variant="outline" size="sm" onClick={reset} className="mt-2 h-7 text-xs">
                Importar otro archivo
              </Button>
            </div>
          ) : parseError ? (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/5 border border-destructive/20">
              <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-destructive">{parseError}</p>
                <Button variant="ghost" size="sm" onClick={reset} className="mt-2 h-7 text-xs p-0">
                  Intentar con otro archivo
                </Button>
              </div>
            </div>
          ) : parsed ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground truncate max-w-[200px]">{fileName}</span>
                  <Badge variant="outline" className="text-xs">{parsed.length} productos</Badge>
                </div>
                <button onClick={reset} className="text-muted-foreground/60 hover:text-muted-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Preview table */}
              <div className="border border-border rounded-lg overflow-hidden">
                <div className="max-h-52 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Nombre</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Precio</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Stock</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Variantes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.slice(0, 50).map((p, i) => (
                        <tr key={i} className="border-t border-border/50">
                          <td className="px-3 py-1.5 font-medium truncate max-w-[160px]">{p.name}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">
                            {p.price > 0 ? `$${p.price.toLocaleString("es-AR")}` : "—"}
                          </td>
                          <td className="px-3 py-1.5 text-muted-foreground">{p.stock}</td>
                          <td className="px-3 py-1.5">
                            {p.variants.length > 0 ? (
                              <Badge variant="outline" className="text-[10px] h-4 px-1">
                                {p.variants.length} vars
                              </Badge>
                            ) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {parsed.length > 50 && (
                    <p className="text-center text-xs text-muted-foreground py-2">+{parsed.length - 50} más</p>
                  )}
                </div>
              </div>

              <Button
                className="w-full gradient-gold text-primary-foreground shadow-gold h-9"
                onClick={handleImport}
                disabled={importing}
              >
                {importing ? (
                  <><Loader2 className="w-4 h-4 animate-spin mr-2" />Importando…</>
                ) : (
                  <><Upload className="w-4 h-4 mr-2" />Confirmar importación de {parsed.length} productos</>
                )}
              </Button>
            </div>
          ) : (
            <FilePicker
              accept=".xlsx,.xls,.csv"
              title="Arrastrá el Excel o elegilo desde tu equipo"
              description="Archivos .xlsx, .xls o .csv exportados de Tiendanube"
              icon={FileSpreadsheet}
              inputRef={fileRef}
              onFile={handleFile}
            />
          )}
        </div>
      )}
    </div>
  );
}
