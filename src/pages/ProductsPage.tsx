import { useState, useEffect, useRef, useMemo, type ReactNode } from "react";
import Fuse from "fuse.js";
import { useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { cotizacionDe, costoArsONull, faltaCotizacion } from "@/lib/exchangeRate";
import { useOrg } from "@/lib/orgContext";
import { useEntitlements } from "@/lib/useEntitlements";
import UpgradePrompt from "@/components/shared/UpgradePrompt";
import { getProductsDB, addProductDB, updateProductDB, deleteProductDB, getSettingsDB, formatARS, formatUSD, getCategoryLabel, calculateProductProfits, getVariantsDB, addVariantDB, updateVariantDB, deleteVariantDB, setStockAbsoluteDB, getVariantsByUserDB } from "@/lib/supabaseStore";
import ProductPriceListsSection from "@/components/products/ProductPriceListsSection";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useCountdown } from "@/hooks/useCountdown";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Plus, Pencil, Trash2, Search, Package, AlertTriangle, TrendingUp, Upload, X, FileSpreadsheet, Clock, Star, Sparkles, Droplets, Layers, DollarSign, FileText, ShoppingCart, QrCode, BarChart2, ChevronDown, ChevronUp, FileDown, Tag, Zap, LayoutGrid, List, Square, CheckSquare, CheckCheck, Brain, ScanLine, Check, Share2, Copy, Calculator, SlidersHorizontal, Scale, Loader2, ExternalLink, RefreshCw } from "lucide-react";
import { FAMILIAS_OLFATIVAS, DURACIONES, PROYECCIONES, ESTACIONES, OCASIONES, NOTAS_COMUNES, GENEROS, taxLabel, type TaxItem } from "@/lib/scentTaxonomy";
import { recommendSimilar } from "@/lib/perfumeMatch";
import { normalizeText, literalFilter } from "@/lib/searchText";
import { getCategoryMarkup, getCategoryDiscount, calcAutoSalePrice, calcAutoDiscountPrice } from "@/lib/pricing";
import PerfumeRecommenderModal from "@/components/products/PerfumeRecommenderModal";
import PageHeader from "@/components/shared/PageHeader";
import WorkspaceViewTabs from "@/components/shared/WorkspaceViewTabs";
import DataPagination from "@/components/shared/DataPagination";
import CalidadPublicaciones, { BadgeCalidad } from "@/components/products/CalidadPublicaciones";
import CompletarPesos from "@/components/products/CompletarPesos";
import CategorySelect, { useOrgCategories, type OpcionCategoria } from "@/components/products/CategorySelect";
import { colorDeCategoria, nombreDeCategoria } from "@/lib/storeCategories";
import ProductTypesManager from "@/components/products/ProductTypesManager";
import { REGLAS, type ImpactoId } from "@/lib/productQuality";
import {
  listAttributeDefinitions,
  listProductAttributeValues,
  listProductTypes,
  saveProductAttributeValues,
  type AttributeDefinition,
  type ProductType,
} from "@/lib/productTypes";
import KPICard from "@/components/shared/KPICard";
import IdentityHealthPanel from "@/components/shared/IdentityHealthPanel";
import { toast } from "sonner";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import ProductsExcelImport from "@/components/products/ProductsExcelImport";
import WorkspaceState from "@/components/shared/WorkspaceState";
import { logAudit } from "@/lib/auditLog";
import { useModulePermissions } from "@/lib/usePermissions";
import { useAIProductSuggest } from "@/hooks/useAIProductSuggest";
import BarcodeScanModal from "@/components/shared/BarcodeScanModal";
import { broadcastSync } from "@/lib/broadcastSync";
import { useWebShare } from "@/hooks/useWebShare";
import { useClipboard } from "@/hooks/useClipboard";
import { PriceSparkline } from "@/components/shared/PriceSparkline";
import ProfitCalculatorModal from "@/components/shared/ProfitCalculatorModal";
import { useProductExpiry } from "@/hooks/useProductExpiry";
import { BarcodePrintSheet } from "@/components/shared/BarcodeLabel";
import { orgViewKey, usePersistedState } from "@/hooks/usePersistedState";
import { mensajeDeEdgeFunction } from "@/lib/edgeErrors";
import { Switch } from "@/components/ui/switch";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";

import { plural } from "@/lib/plural";
const GENDER_ICONS: Record<string, string> = { masculino: '♂', femenino: '♀', unisex: '⚥' };
const PAGE_SIZE = 30;

function productLoadErrorMessage(cause: unknown, fallback: string) {
  if (cause instanceof Error && cause.message.trim()) return cause.message;
  if (cause && typeof cause === 'object' && 'message' in cause) {
    const message = String((cause as { message?: unknown }).message ?? '').trim();
    if (message) return message;
  }
  return fallback;
}

function settledValue<T>(result: PromiseSettledResult<T>): T {
  if (result.status === 'rejected') throw result.reason;
  return result.value;
}

function exportPriceLabels(products: any[], businessName: string) {
  const items = products.filter(p => p.stock > 0 || true).slice(0, 80);
  if (!items.length) return;
  const fmtARS = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);
  const rows = items.map(p => {
    const hasDiscount = p.discount_price_ars && Number(p.discount_price_ars) < Number(p.sale_price_ars);
    const price = hasDiscount ? Number(p.discount_price_ars) : Number(p.sale_price_ars);
    const originalPrice = Number(p.sale_price_ars);
    return `
      <div class="label">
        <div class="biz">${businessName}</div>
        <div class="name">${p.name.slice(0, 32)}${p.name.length > 32 ? '…' : ''}</div>
        ${p.brand && p.brand !== p.name ? `<div class="brand">${p.brand}</div>` : ''}
        ${hasDiscount ? `
          <div class="old-price">${fmtARS(originalPrice)}</div>
          <div class="price discount">${fmtARS(price)}</div>
          <div class="badge-oferta">OFERTA</div>
        ` : `
          <div class="price">${fmtARS(price)}</div>
        `}
        ${p.sku || p.barcode ? `<div class="sku">${p.sku || p.barcode}</div>` : ''}
      </div>`;
  }).join('');
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Etiquetas de precio — ${businessName}</title>
<style>
  @page { margin: 8mm; }
  body { font-family: Arial, sans-serif; margin: 0; background: #fff; }
  h2 { font-size: 11px; color: #666; text-align: center; margin: 0 0 6px; }
  .grid { display: flex; flex-wrap: wrap; gap: 3mm; justify-content: flex-start; }
  .label {
    width: 55mm; min-height: 32mm; border: 0.5px solid #ccc; border-radius: 3px;
    padding: 3mm 3.5mm; display: flex; flex-direction: column; justify-content: center;
    break-inside: avoid; box-sizing: border-box; position: relative; background: #fff;
  }
  .biz { font-size: 6px; color: #aaa; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 1.5mm; }
  .name { font-size: 9px; font-weight: bold; color: #111; word-break: break-word; line-height: 1.3; }
  .brand { font-size: 7px; color: #777; margin-top: 0.5mm; }
  .price { font-size: 16px; font-weight: bold; color: #1a1a2e; margin-top: 2mm; }
  .price.discount { color: #c00; }
  .old-price { font-size: 9px; color: #aaa; text-decoration: line-through; margin-top: 1.5mm; }
  .badge-oferta {
    position: absolute; top: 2mm; right: 2mm;
    background: #c00; color: #fff; font-size: 6px; font-weight: bold;
    padding: 1px 3px; border-radius: 2px; letter-spacing: 0.5px;
  }
  .sku { font-size: 6px; color: #bbb; font-family: monospace; margin-top: 1.5mm; }
</style></head><body>
<h2>${businessName} — Etiquetas de precio (${plural(items.length, "producto")})</h2>
<div class="grid">${rows}</div>
</body></html>`;
  const w = window.open('', '_blank', 'width=900,height=700');
  if (w) { w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 800); }
}

function exportQRLabels(products: any[], businessName: string) {
  const inStock = products.filter(p => p.stock > 0).slice(0, 60);
  if (!inStock.length) return;
  const fmtARS = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);
  const rows = inStock.map(p => {
    const price = p.discount_price_ars && Number(p.discount_price_ars) < Number(p.sale_price_ars)
      ? Number(p.discount_price_ars) : Number(p.sale_price_ars);
    const qrData = encodeURIComponent(JSON.stringify({ id: p.id, name: p.name, price }));
    return `
      <div class="label">
        <div class="qr-wrap">
          <img src="https://api.qrserver.com/v1/create-qr-code/?size=80x80&data=${qrData}" alt="QR" width="80" height="80" />
        </div>
        <div class="info">
          <div class="name">${p.name.slice(0, 28)}${p.name.length > 28 ? '…' : ''}</div>
          ${p.brand ? `<div class="brand">${p.brand}</div>` : ''}
          <div class="price">${fmtARS(price)}</div>
          ${p.sku || p.barcode ? `<div class="sku">${p.sku || p.barcode}</div>` : ''}
        </div>
      </div>`;
  }).join('');
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Etiquetas QR — ${businessName}</title>
<style>
  @page { margin: 10mm; }
  body { font-family: Arial, sans-serif; margin: 0; background: #fff; }
  h2 { font-size: 12px; color: #555; text-align: center; margin: 0 0 8px; }
  .grid { display: flex; flex-wrap: wrap; gap: 4mm; justify-content: flex-start; }
  .label { width: 55mm; border: 0.5px solid #ddd; border-radius: 4px; padding: 3mm; display: flex; align-items: center; gap: 3mm; break-inside: avoid; }
  .qr-wrap img { display: block; }
  .info { flex: 1; min-width: 0; }
  .name { font-size: 8px; font-weight: bold; color: #111; word-break: break-word; line-height: 1.2; }
  .brand { font-size: 7px; color: #777; margin-top: 1px; }
  .price { font-size: 11px; font-weight: bold; color: #b8860b; margin-top: 2px; }
  .sku { font-size: 6px; color: #aaa; font-family: monospace; margin-top: 1px; }
</style></head><body>
<h2>${businessName} — Etiquetas QR (${plural(inStock.length, "producto")})</h2>
<div class="grid">${rows}</div>
</body></html>`;
  const w = window.open('', '_blank', 'width=900,height=700');
  if (w) { w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 800); }
}

function printAgingPDF(aged: { name: string; stock: number; daysSince: number; valueARS: number }[], businessName: string, exchangeRate: number) {
  const totalValue = aged.reduce((s, p) => s + p.valueARS, 0);
  const rows = aged.map(p => `
    <tr>
      <td>${p.name}</td>
      <td style="text-align:center">${p.stock}</td>
      <td style="text-align:center">${p.daysSince >= 999 ? "Nunca" : p.daysSince + "d"}</td>
      <td style="text-align:right">U$S ${(p.valueARS / exchangeRate).toFixed(2)}</td>
      <td style="text-align:right; color:${p.daysSince >= 91 ? "#f87171" : p.daysSince >= 61 ? "#fb923c" : "#fbbf24"}">
        ${p.daysSince >= 91 ? "⚠ Liquidar" : p.daysSince >= 61 ? "Promocionar" : "Vigilar"}
      </td>
    </tr>`).join('');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Inventario sin movimiento</title>
  <style>body{font-family:Arial,sans-serif;padding:20px;color:#111}h1{font-size:18px;margin-bottom:4px}p{font-size:12px;color:#555;margin-bottom:16px}
  table{width:100%;border-collapse:collapse;font-size:12px}th{background:#f3f4f6;padding:8px;text-align:left;border-bottom:2px solid #e5e7eb}
  td{padding:6px 8px;border-bottom:1px solid #e5e7eb}tfoot td{font-weight:bold;border-top:2px solid #111}</style></head>
  <body><h1>${businessName} — Inventario sin movimiento</h1>
  <p>Generado el ${new Date().toLocaleDateString("es-AR")} · ${plural(aged.length, "producto")} · U$S ${(totalValue / exchangeRate).toFixed(0)} inmovilizado</p>
  <table><thead><tr><th>Producto</th><th>Stock</th><th>Sin venta</th><th>Costo estimado</th><th>Sugerencia</th></tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr><td colspan="3">TOTAL</td><td style="text-align:right">U$S ${(totalValue / exchangeRate).toFixed(0)}</td><td></td></tr></tfoot>
  </table></body></html>`;
  const w = window.open('', '_blank');
  if (w) { w.document.write(html); w.document.close(); w.print(); }
}

function exportPriceListPDF(products: any[], businessName: string) {
  const inStock = products.filter(p => p.stock > 0);
  const grouped: Record<string, typeof inStock> = {};
  inStock.forEach(p => {
    const cat = getCategoryLabel(p.category || 'otros');
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(p);
  });
  const date = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });
  let rows = '';
  Object.entries(grouped).forEach(([cat, items]) => {
    rows += `<tr class="cat-row"><td colspan="3">${cat}</td></tr>`;
    items.forEach(p => {
      rows += `<tr>
        <td>${p.name}${p.brand ? ` <span class="brand">${p.brand}</span>` : ''}${p.gender ? ` <span class="gender">${p.gender}</span>` : ''}</td>
        <td class="price">${formatARS(Number(p.sale_price_ars))}</td>
        <td class="price">${p.discount_price_ars ? formatARS(Number(p.discount_price_ars)) : '—'}</td>
      </tr>`;
    });
  });
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Lista de Precios</title>
<style>
  body{font-family:Arial,sans-serif;margin:20px;font-size:12px;color:#222}
  h1{font-size:20px;margin-bottom:2px}
  .sub{color:#666;font-size:11px;margin-bottom:16px}
  table{border-collapse:collapse;width:100%}
  th{background:#1a1a2e;color:#d4a843;font-size:11px;text-transform:uppercase;letter-spacing:.5px;padding:6px 8px;text-align:left}
  th.price,td.price{text-align:right}
  tr:nth-child(even){background:#f9f9f9}
  .cat-row td{background:#f0e8d0;font-weight:700;font-size:11px;padding:4px 8px;color:#7a5a00;text-transform:uppercase;letter-spacing:.5px}
  td{padding:5px 8px;border-bottom:1px solid #eee}
  .brand{color:#888;font-size:10px}
  .gender{color:#999;font-size:10px}
  .footer{margin-top:16px;font-size:10px;color:#999;text-align:center}
  @media print{.no-print{display:none}}
</style></head><body>
<h1>${businessName}</h1>
<div class="sub">Lista de precios — ${date} · ${plural(inStock.length, "producto")} disponibles</div>
<table>
  <thead><tr><th>Producto</th><th class="price">Precio</th><th class="price">Oferta</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="footer">Precios en pesos argentinos (ARS). Sujetos a cambios sin previo aviso.</div>
</body></html>`;
  const w = window.open('', '_blank');
  if (w) { w.document.write(html); w.document.close(); w.print(); }
}

async function exportProductsXLSX(products: any[], settings: any) {
  const { utils, writeFile } = await import('xlsx');
  const categories = [...new Set(products.map((p: any) => p.category))];
  const wb = utils.book_new();
  
  for (const cat of categories) {
    const catProducts = products.filter((p: any) => p.category === cat);
    const rows = catProducts.map((p: any) => ({
      'Nombre': p.name,
      'Marca': p.brand,
      'Género': p.gender,
      'Costo USD': Number(p.cost_usd),
      'Pasero USD': Number(p.customs_fee),
      'Costo Total USD': Number(p.total_cost_usd),
      'Precio Venta ARS': Number(p.sale_price_ars),
      'Precio Desc. ARS': Number(p.discount_price_ars) || '',
      'Ganancia ARS': Number(p.profit_per_unit_ars),
      'Stock': p.stock,
      'Última Mod.': new Date(p.updated_at).toLocaleDateString('es-AR'),
    }));
    const ws = utils.json_to_sheet(rows);
    ws['!cols'] = [{ wch: 30 }, { wch: 15 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 8 }, { wch: 12 }];
    utils.book_append_sheet(wb, ws, getCategoryLabel(cat).substring(0, 31));
  }
  
  // All products sheet
  const allRows = products.map((p: any) => ({
    'Nombre': p.name, 'Marca': p.brand, 'Categoría': getCategoryLabel(p.category),
    'Costo USD': Number(p.total_cost_usd), 'Venta ARS': Number(p.sale_price_ars),
    'Desc. ARS': Number(p.discount_price_ars) || '', 'Ganancia ARS': Number(p.profit_per_unit_ars),
    'Stock': p.stock, 'Última Mod.': new Date(p.updated_at).toLocaleDateString('es-AR'),
  }));
  const wsAll = utils.json_to_sheet(allRows);
  wsAll['!cols'] = [{ wch: 30 }, { wch: 15 }, { wch: 18 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 8 }, { wch: 12 }];
  utils.book_append_sheet(wb, wsAll, 'Todos');
  
  writeFile(wb, `productos_exentry_${new Date().toISOString().slice(0, 10)}.xlsx`);
  toast.success('Excel exportado con hojas por categoría');
}

/** Shows a live countdown on product cards/rows that have offer_expires_at set */
function OfferCountdownBadge({ expiresAt }: { expiresAt: string }) {
  const target = new Date(expiresAt);
  const { hours, minutes, seconds, isExpired } = useCountdown(target);
  if (isExpired) return <span className="text-[9px] text-red-400 font-medium">Expiró</span>;
  if (hours > 24) {
    const days = Math.ceil(hours / 24);
    return <span className="text-[9px] text-orange-400 font-medium">Vence en {days}d</span>;
  }
  return (
    <span className="text-[9px] text-orange-400 font-bold font-mono">
      {String(hours).padStart(2,'0')}:{String(minutes).padStart(2,'0')}:{String(seconds).padStart(2,'0')}
    </span>
  );
}

export default function ProductsPage() {
  usePageTitle("Productos");
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeOrg, activeRole } = useOrg();
  const { productLimit, plan } = useEntitlements();
  const { online } = useNetworkStatus();
  const [identityParams, setIdentityParams] = useSearchParams();
  // Module-aware permissions: admins can grant/deny per-module via role_permissions
  // (falls back to role defaults if no DB rows exist)
  const { canCreate, canEdit, canDelete } = useModulePermissions("products");
  const [products, setProducts] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [salesVelocity, setSalesVelocity] = useState<Record<string, number>>({}); // units sold per day per product
  const [lastSaleDate, setLastSaleDate] = useState<Record<string, string>>({}); // last sale date per product id
  const [open, setOpen] = useState(false);
  const [productTypesOpen, setProductTypesOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [search, setSearch] = usePersistedState(orgViewKey("products.search", activeOrg?.id), '');
  const [filterCat, setFilterCat] = usePersistedState(orgViewKey("products.category-filter", activeOrg?.id), 'all');
  const [filterStock, setFilterStock] = usePersistedState(orgViewKey("products.stock-filter", activeOrg?.id), 'all');
  const [filterExpiry, setFilterExpiry] = usePersistedState(orgViewKey("products.expiry-filter", activeOrg?.id), 'all');
  const [filterTag, setFilterTag] = usePersistedState(orgViewKey("products.tag-filter", activeOrg?.id), '');
  const [filterMovement, setFilterMovement] = usePersistedState(orgViewKey("products.movement-filter", activeOrg?.id), 'all');
  const [filterMargin, setFilterMargin] = usePersistedState(orgViewKey("products.margin-filter", activeOrg?.id), 'all');
  const [filterDiscount, setFilterDiscount] = usePersistedState(orgViewKey("products.discount-filter", activeOrg?.id), false);
  // ── Buscador de perfumes por facetas ──────────────────────────────────────
  const [perfumeDetailsByProduct, setPerfumeDetailsByProduct] = useState<Record<string, any>>({});
  const [facetSheetOpen, setFacetSheetOpen] = useState(false);
  const [filterFamilia, setFilterFamilia] = useState<string[]>([]);
  const [filterNotas, setFilterNotas] = useState<string[]>([]);
  const [filterEstacion, setFilterEstacion] = useState<string[]>([]);
  const [filterOcasion, setFilterOcasion] = useState<string[]>([]);
  const [filterGenderFacet, setFilterGenderFacet] = useState<string[]>([]);
  const [filterMaxPrice, setFilterMaxPrice] = useState('');
  // Filtro por lo que le falta a la ficha. Sin esto, el panel de calidad es
  // una lista de reproches que no lleva a ningún lado.
  const [filterCalidad, setFilterCalidad] = useState<ImpactoId | null>(null);
  // Las categorías de la organización, para los filtros y la oferta masiva. El
  // formulario usa `<CategorySelect>`, que además deja crear.
  const { opciones: opcionesCategoria, categorias: categoriasOrg } = useOrgCategories(activeOrg?.id);
  // El nombre que le puso el comercio. `getCategoryLabel` sigue sirviendo en los
  // helpers de módulo, que no tienen organización a mano, pero adentro de la
  // página hay que usar el de verdad: si renombró "Vaper" a "Pods", el badge
  // tiene que decir Pods.
  const nombreCategoria = (slug: string) => nombreDeCategoria(slug, categoriasOrg);
  const [pesosOpen, setPesosOpen] = useState(false);
  const facetCount = filterFamilia.length + filterNotas.length + filterEstacion.length + filterOcasion.length + filterGenderFacet.length + (filterMaxPrice ? 1 : 0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [partialWarning, setPartialWarning] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);
  const [hasLoadedData, setHasLoadedData] = useState(false);
  const hasLoadedDataRef = useRef(false);
  const loadRequestRef = useRef(0);
  const activeOrgIdRef = useRef<string | null>(activeOrg?.id ?? null);
  const loadedOrgIdRef = useRef<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [variantCounts, setVariantCounts] = useState<Record<string, number>>({});
  const [priceHistoryProduct, setPriceHistoryProduct] = useState<{ id: string; name: string } | null>(null);
  const [editingStock, setEditingStock] = useState<{ id: string; value: string } | null>(null);
  const [editingThreshold, setEditingThreshold] = useState<{ id: string; value: string } | null>(null);
  const [showAging, setShowAging] = useState(false);
  const [productSort, setProductSort] = useState<{ col: "name" | "sale_price_ars" | "stock" | "margin"; dir: "asc" | "desc" }>({ col: "name", dir: "asc" });
  const [productView, setProductView] = usePersistedState<'list' | 'grid'>(orgViewKey("products.view", activeOrg?.id), 'list');
  const [productsWorkspaceTab, setProductsWorkspaceTab] = usePersistedState<"catalog" | "overview">(
    orgViewKey("products.workspace-tab", activeOrg?.id),
    "catalog",
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const { shareProduct, canShare } = useWebShare();
  const { copy: copyText } = useClipboard();
  const [calcProduct, setCalcProduct] = useState<any | null>(null);
  const [calcOpen, setCalcOpen] = useState(false);
  const [barcodeOpen, setBarcodeOpen] = useState(false);
  const [recoTargetId, setRecoTargetId] = useState<string | null>(null);
  // Oferta masiva por categoría
  const [catOfferOpen, setCatOfferOpen] = useState(false);
  const [catOfferCategory, setCatOfferCategory] = useState('');  // sin rubro por defecto: ver 20260825000002_categoria_sin_rubro
  const [catOfferPct, setCatOfferPct] = useState('20');
  const [catOfferExpiry, setCatOfferExpiry] = useState('');
  const [catOfferSaving, setCatOfferSaving] = useState(false);

  const reload = useCallback(async () => {
    if (!user?.id || !activeOrg?.id) return;
    const orgId = activeOrg.id;
    const request = ++loadRequestRef.current;
    const hasVisibleData = hasLoadedDataRef.current && loadedOrgIdRef.current === orgId;
    setLoading(!hasVisibleData);
    setRefreshing(hasVisibleData);
    setLoadError(null);
    const since60 = new Date(); since60.setDate(since60.getDate() - 60);
    const results = await Promise.allSettled([
      getProductsDB(user.id),
      getSettingsDB(user.id),
      getVariantsByUserDB(user.id),
      supabase.from('sales')
        .select('product_id, quantity, date')
        .eq('org_id', orgId)
        .gte('date', since60.toISOString().slice(0, 10))
        .then(({ data, error }) => {
          if (error) throw error;
          return data ?? [];
        }),
      supabase.from('product_perfume_details')
        .select('*')
        .eq('org_id', orgId)
        .then(({ data, error }) => {
          if (error) throw error;
          return data ?? [];
        }),
    ]);
    if (request !== loadRequestRef.current || activeOrgIdRef.current !== orgId) return;

    const [productsResult, settingsResult, variantsResult, salesResult, perfumeResult] = results;
    const coreResults = [
      ['productos', productsResult],
      ['ajustes de costos y precios', settingsResult],
    ] as const;
    const failedCore = coreResults.filter(([, result]) => result.status === 'rejected');
    if (failedCore.length > 0) {
      const failedNames = failedCore.map(([name]) => name).join(', ');
      const firstFailure = failedCore[0][1];
      const detail = productLoadErrorMessage(
        firstFailure.status === 'rejected' ? firstFailure.reason : null,
        'La consulta no respondió.',
      );
      console.error('[Productos] no se pudo actualizar el catálogo', { failedNames, detail });
      setLoadError(`No pudimos actualizar ${failedNames}. ${detail}`);
      setRefreshing(false);
      setLoading(false);
      return;
    }

    setProducts(settledValue(productsResult));
    setSettings(settledValue(settingsResult));
    loadedOrgIdRef.current = orgId;
    hasLoadedDataRef.current = true;
    setHasLoadedData(true);
    setLastLoadedAt(new Date());

    const failedSupporting: string[] = [];
    if (variantsResult.status === 'fulfilled') {
      const counts: Record<string, number> = {};
      variantsResult.value.forEach((variant: any) => {
        counts[variant.product_id] = (counts[variant.product_id] || 0) + 1;
      });
      setVariantCounts(counts);
    } else {
      failedSupporting.push('variantes');
      console.error('[Productos] no se pudieron actualizar las variantes', variantsResult.reason);
    }

    if (perfumeResult.status === 'fulfilled') {
      const perfumeMap: Record<string, any> = {};
      perfumeResult.value.forEach((detail: any) => { perfumeMap[detail.product_id] = detail; });
      setPerfumeDetailsByProduct(perfumeMap);
    } else {
      failedSupporting.push('fichas de perfume');
      console.error('[Productos] no se pudieron actualizar las fichas de perfume', perfumeResult.reason);
    }

    if (salesResult.status === 'fulfilled') {
      // Calculate daily sales velocity per product (units/day over last 60 days).
      const velocity: Record<string, number> = {};
      const lastSale: Record<string, string> = {};
      salesResult.value.forEach((sale: any) => {
        if (sale.product_id) {
          velocity[sale.product_id] = (velocity[sale.product_id] || 0) + Number(sale.quantity || 1);
          if (!lastSale[sale.product_id] || sale.date > lastSale[sale.product_id]) {
            lastSale[sale.product_id] = sale.date;
          }
        }
      });
      Object.keys(velocity).forEach(id => { velocity[id] = velocity[id] / 60; });
      setSalesVelocity(velocity);
      setLastSaleDate(lastSale);
    } else {
      failedSupporting.push('movimiento de ventas');
      console.error('[Productos] no se pudo actualizar el movimiento de ventas', salesResult.reason);
    }

    setPartialWarning(failedSupporting.length > 0
      ? `El catálogo está disponible, pero faltan ${failedSupporting.join(', ')}. Los conteos, filtros o sugerencias relacionados pueden estar incompletos.`
      : null);
    setRefreshing(false);
    setLoading(false);
  }, [activeOrg?.id, user?.id]);

  useEffect(() => {
    // Never render the previous organization while the next tenant is loading.
    activeOrgIdRef.current = activeOrg?.id ?? null;
    loadedOrgIdRef.current = null;
    hasLoadedDataRef.current = false;
    setHasLoadedData(false);
    setProducts([]);
    setSettings(null);
    setVariantCounts({});
    setPerfumeDetailsByProduct({});
    setSalesVelocity({});
    setLastSaleDate({});
    setLoadError(null);
    setPartialWarning(null);
    setLastLoadedAt(null);
    setLoading(true);
    setRefreshing(false);
    void reload();
    return () => { loadRequestRef.current += 1; };
  }, [activeOrg?.id, reload]);

  useEffect(() => {
    const identityId = identityParams.get("identity");
    if (!identityId || loading) return;
    const product = products.find(item => item.id === identityId);
    if (!product) return;
    setEditing(product);
    setOpen(true);
    const next = new URLSearchParams(identityParams);
    next.delete("identity");
    setIdentityParams(next, { replace: true });
  }, [identityParams, loading, products, setIdentityParams]);

  const saveInlineStock = async (productId: string, newStock: string) => {
    const parsed = parseInt(newStock, 10);
    if (isNaN(parsed) || parsed < 0 || !user) { setEditingStock(null); return; }
    await setStockAbsoluteDB({
      productId,
      newStock: parsed,
      userId: user.id,
      notes: "Ajuste de stock desde Productos",
    });
    setProducts(prev => prev.map(p => p.id === productId ? { ...p, stock: parsed } : p));
    setEditingStock(null);
    toast.success("Stock actualizado");
  };

  const saveInlineThreshold = async (productId: string, val: string) => {
    const parsed = parseInt(val, 10);
    if (isNaN(parsed) || parsed < 0) { setEditingThreshold(null); return; }
    await updateProductDB(productId, { low_stock_threshold: parsed } as any);
    setProducts(prev => prev.map(p => p.id === productId ? { ...p, low_stock_threshold: parsed } : p));
    setEditingThreshold(null);
    toast.success("Alerta de stock actualizada");
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const in30Days = new Date(today); in30Days.setDate(today.getDate() + 30);
  const in90Days = new Date(today); in90Days.setDate(today.getDate() + 90);

  const { expired, critical, warning, totalAtRisk, all: allExpiryProducts } = useProductExpiry(products);
  // Legacy alias for filter UI that already uses this
  const expiringSoon = allExpiryProducts.filter(p =>
    (p.urgency === "expired" || p.urgency === "critical" || p.urgency === "warning") && p.stock > 0
  );

  // Fuse.js index — rebuilt only when products list changes
  const fuseIndex = useMemo(() => new Fuse(products, {
    keys: [
      { name: 'name', weight: 0.55 },
      { name: 'brand', weight: 0.25 },
      { name: 'sku', weight: 0.1 },
      { name: 'barcode', weight: 0.1 },
    ],
    // Umbral estricto: solo tolera errores de tipeo, no coincidencias sueltas.
    threshold: 0.3,
    minMatchCharLength: 2,
    ignoreLocation: true,
  }), [products]);

  const searchMatchIds = useMemo(() => {
    const q = normalizeText(search).trim();
    if (!q || q.length < 2) return null;
    // 1) Coincidencia literal: TODOS los términos tienen que aparecer en el
    //    producto (nombre, marca, SKU o código). Ver src/lib/searchText.ts.
    const literal = literalFilter(products, search, p => [p.name, p.brand, p.sku, p.barcode]);
    if (literal.length > 0) return new Set(literal.map(p => p.id));
    // 2) Si no hubo ninguna, recién ahí buscamos difuso (tolera typos).
    return new Set(fuseIndex.search(q).map(r => r.item.id));
  }, [products, fuseIndex, search]);

  // La ficha técnica vive en otra tabla, así que se adjunta acá: la regla de
  // calidad recibe un producto plano y no sabe nada de cómo se carga.
  const paraCalidad = useMemo(() => products.map((p: any) => ({
    ...p,
    tiene_ficha: !!perfumeDetailsByProduct[p.id]
      && Object.values(perfumeDetailsByProduct[p.id]).some(
        (v: any) => Array.isArray(v) ? v.length > 0 : (typeof v === 'string' && v.trim() !== ''),
      ),
  })), [products, perfumeDetailsByProduct]);

  const calidadPorProducto = useMemo(
    () => new Map(paraCalidad.map((p: any) => [p.id, p])), [paraCalidad]);

  // La cotización del comercio, una sola vez para todo el filtrado y el orden.
  // `null` = no cargó ninguna, y eso NO es cero: ver `cotizacionDe`.
  const cotizacion = cotizacionDe(settings);

  // ⚠️ Productos cuyo costo NO se puede saber: están en dólares y el comercio
  // no cargó cotización. Antes se multiplicaban por 1695 y el margen salía
  // igual — mal, pero sin avisar. Ahora se cuentan y se dicen.
  const sinCostoUtilizable = cotizacion === null
    ? products.filter((p: any) => Number(p.cost_ars) <= 0 && Number(p.total_cost_usd || p.cost_usd) > 0).length
    : 0;

  const filtered = products.filter(p => {
    if (filterCalidad) {
      const regla = REGLAS.find(r => r.id === filterCalidad);
      const conFicha = calidadPorProducto.get(p.id) ?? p;
      if (regla && regla.cumple(conFicha as never)) return false;
    }
    if (search && search.length >= 2 && searchMatchIds && !searchMatchIds.has(p.id)) return false;
    if (search && search.length < 2 && !normalizeText(p.name).includes(normalizeText(search)) && !normalizeText(p.brand ?? '').includes(normalizeText(search))) return false;
    if (filterCat !== 'all' && p.category !== filterCat) return false;
    if (filterStock === 'instock' && p.stock <= 0) return false;
    if (filterStock === 'low' && (p.stock > 3 || p.stock <= 0)) return false;
    if (filterStock === 'out' && p.stock > 0) return false;
    if (filterExpiry === 'expired') { if (!p.expiry_date || new Date(p.expiry_date) >= today) return false; }
    if (filterExpiry === 'soon30') { if (!p.expiry_date) return false; const exp = new Date(p.expiry_date); if (exp < today || exp > in30Days) return false; }
    if (filterExpiry === 'soon90') { if (!p.expiry_date) return false; const exp = new Date(p.expiry_date); if (exp < today || exp > in90Days) return false; }
    if (filterExpiry === 'has_expiry' && !p.expiry_date) return false;
    if (filterTag && !(p.tags || []).includes(filterTag)) return false;
    if (filterMovement === 'no30') {
      const last = lastSaleDate[p.id];
      if (last) {
        const daysSince = Math.floor((today.getTime() - new Date(last + 'T12:00:00').getTime()) / 86400000);
        if (daysSince < 30) return false;
      }
      // products with no sale data in 60 days always match 'no30'
    }
    if (filterMargin !== 'all') {
      const saleP = Number(p.sale_price_ars) || 0;
      // ⚠️ Sin cotización, el costo de un producto en dólares es DESCONOCIDO.
      // Antes se multiplicaba por 1695 y el producto entraba o salía del filtro
      // según un dólar inventado. Un margen que no se puede calcular no
      // clasifica: el producto no matchea ni "bajo" ni "alto".
      const costP = costoArsONull(
        { costUsd: p.total_cost_usd, costArs: p.cost_ars, costCurrency: p.cost_currency },
        cotizacion);
      if (costP === null) return false;
      const margin = saleP > 0 ? ((saleP - costP) / saleP) * 100 : 0;
      if (filterMargin === 'low' && margin >= 20) return false;
      if (filterMargin === 'mid' && (margin < 20 || margin >= 40)) return false;
      if (filterMargin === 'high' && margin < 40) return false;
      if (filterMargin === 'negative' && margin >= 0) return false;
    }
    if (filterDiscount && !(p.discount_price_ars && Number(p.discount_price_ars) < Number(p.sale_price_ars))) return false;
    // ── Facetas de perfume ──────────────────────────────────────────────
    if (filterMaxPrice) {
      const price = Number(p.discount_price_ars) || Number(p.sale_price_ars) || 0;
      if (price <= 0 || price > Number(filterMaxPrice)) return false;
    }
    if (filterGenderFacet.length && !filterGenderFacet.includes(p.gender)) return false;
    if (filterFamilia.length || filterNotas.length || filterEstacion.length || filterOcasion.length) {
      const d = perfumeDetailsByProduct[p.id];
      if (!d) return false; // sin ficha no matchea ninguna faceta de perfume
      if (filterFamilia.length && !filterFamilia.includes(d.familia_olfativa)) return false;
      if (filterEstacion.length && !filterEstacion.some((e: string) => (d.estacion || []).includes(e))) return false;
      if (filterOcasion.length && !filterOcasion.some((o: string) => (d.ocasion || []).includes(o))) return false;
      if (filterNotas.length) {
        const allNotas = [...(d.notas_salida || []), ...(d.notas_corazon || []), ...(d.notas_fondo || [])];
        if (!filterNotas.some((n: string) => allNotas.includes(n))) return false;
      }
    }
    return true;
  });

  // Collect all unique tags from products for the filter dropdown
  const allTags = Array.from(new Set(products.flatMap((p: any) => p.tags || []))).sort();

  // Apply sort to filtered
  const filteredSorted = [...filtered].sort((a, b) => {
    const { col, dir } = productSort;
    let va: number | string = 0;
    let vb: number | string = 0;
    if (col === "name") { va = (a.name || "").toLowerCase(); vb = (b.name || "").toLowerCase(); }
    else if (col === "sale_price_ars") { va = Number(a.sale_price_ars) || 0; vb = Number(b.sale_price_ars) || 0; }
    else if (col === "stock") { va = Number(a.stock) || 0; vb = Number(b.stock) || 0; }
    else if (col === "margin") {
      // ⚠️ Un costo desconocido se ordena AL FINAL, no como si fuera cero: con
      // costo 0 el margen da 100% y el producto sin dato encabezaba "lo más
      // rentable".
      const saleA = Number(a.sale_price_ars) || 0;
      const costA = costoArsONull({ costUsd: a.total_cost_usd, costArs: a.cost_ars, costCurrency: a.cost_currency }, cotizacion) ?? Infinity;
      const saleB = Number(b.sale_price_ars) || 0;
      const costB = costoArsONull({ costUsd: b.total_cost_usd, costArs: b.cost_ars, costCurrency: b.cost_currency }, cotizacion) ?? Infinity;
      va = saleA > 0 ? (saleA - costA) / saleA : 0;
      vb = saleB > 0 ? (saleB - costB) / saleB : 0;
    }
    const cmp = va < vb ? -1 : va > vb ? 1 : 0;
    return dir === "asc" ? cmp : -cmp;
  });

  // Group first, then paginate by brand groups to avoid splitting a brand across pages
  const allGrouped = filteredSorted.reduce<Record<string, any[]>>((acc, p) => {
    const rawKey = p.brand || 'Sin marca';
    const existingKey = Object.keys(acc).find(k => k.toLowerCase() === rawKey.toLowerCase());
    const key = existingKey || rawKey;
    (acc[key] = acc[key] || []).push(p);
    return acc;
  }, {});

  const brandKeys = Object.keys(allGrouped).sort((a, b) => a.localeCompare(b, 'es'));
  const totalPages = Math.ceil(brandKeys.length / PAGE_SIZE) || 1;
  const pagedBrandKeys = brandKeys.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const grouped = pagedBrandKeys.reduce<Record<string, any[]>>((acc, key) => {
    acc[key] = allGrouped[key];
    return acc;
  }, {});

  const totalStock = filtered.reduce((s, p) => s + p.stock, 0);
  const totalValue = filtered.reduce((s, p) => s + (Number(p.total_cost_usd) * p.stock), 0);

  const handleDelete = async (p: any) => {
    await deleteProductDB(p.id);
    if (user) await logAudit(user.id, 'delete', 'product', p.id, { name: p.name });
    reload();
    toast.success("Producto eliminado");
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setBulkDeleting(true);
    let deleted = 0;
    for (const id of selectedIds) {
      const p = products.find((x: any) => x.id === id);
      await deleteProductDB(id);
      if (user && p) await logAudit(user.id, 'delete', 'product', id, { name: p.name, bulk: true });
      deleted++;
    }
    setSelectedIds(new Set());
    setBulkDeleting(false);
    reload();
    toast.success(`${deleted} producto${deleted !== 1 ? 's' : ''} eliminado${deleted !== 1 ? 's' : ''}`);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredSorted.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredSorted.map((p: any) => p.id)));
    }
  };

  const toggleQuickDiscount = async (p: any) => {
    const hasDiscount = p.discount_price_ars && Number(p.discount_price_ars) < Number(p.sale_price_ars);
    if (hasDiscount) {
      await updateProductDB(p.id, { discount_price_ars: null });
      toast.success(`Descuento removido de "${p.name}"`);
    } else {
      const pct = getCategoryDiscount(settings, p.category);
      const discounted = calcAutoDiscountPrice(Number(p.sale_price_ars), pct);
      await updateProductDB(p.id, { discount_price_ars: discounted });
      toast.success(`Descuento de ${pct}% aplicado a "${p.name}" → ${formatARS(discounted)}`);
    }
    reload();
  };

  // ── Oferta masiva por categoría ────────────────────────────────────────────
  const catOfferProducts = products.filter(p => p.category === catOfferCategory && Number(p.sale_price_ars) > 0);
  const applyCategoryOffer = async () => {
    const pct = Number(catOfferPct);
    if (!catOfferCategory) { toast.error("Elegí una categoría"); return; }
    if (isNaN(pct) || pct <= 0 || pct >= 100) { toast.error("Descuento inválido"); return; }
    setCatOfferSaving(true);
    try {
      const expiry = catOfferExpiry ? new Date(catOfferExpiry).toISOString() : null;
      await Promise.all(catOfferProducts.map(p => updateProductDB(p.id, {
        discount_price_ars: Math.round(Number(p.sale_price_ars) * (1 - pct / 100)),
        offer_expires_at: expiry,
      } as any)));
      toast.success(`Oferta de ${pct}% aplicada a ${plural(catOfferProducts.length, "producto")} de ${nombreCategoria(catOfferCategory)}`);
      setCatOfferOpen(false);
      reload();
    } catch (e: any) { toast.error(e.message || "Error aplicando la oferta"); }
    finally { setCatOfferSaving(false); }
  };
  const clearCategoryOffer = async () => {
    if (!catOfferCategory) { toast.error("Elegí una categoría"); return; }
    const withOffer = catOfferProducts.filter(p => p.discount_price_ars);
    if (withOffer.length === 0) { toast.info("No hay ofertas activas en esa categoría"); return; }
    setCatOfferSaving(true);
    try {
      await Promise.all(withOffer.map(p => updateProductDB(p.id, { discount_price_ars: null, offer_expires_at: null } as any)));
      toast.success(`Ofertas quitadas de ${plural(withOffer.length, "producto")} de ${nombreCategoria(catOfferCategory)}`);
      setCatOfferOpen(false);
      reload();
    } catch (e: any) { toast.error(e.message || "Error quitando la oferta"); }
    finally { setCatOfferSaving(false); }
  };

  const clearProductFilters = () => {
    setSearch('');
    setFilterCat('all');
    setFilterStock('all');
    setFilterExpiry('all');
    setFilterTag('');
    setFilterMovement('all');
    setFilterMargin('all');
    setFilterDiscount(false);
    setFilterCalidad(null);
    setFilterFamilia([]);
    setFilterNotas([]);
    setFilterEstacion([]);
    setFilterOcasion([]);
    setFilterGenderFacet([]);
    setFilterMaxPrice('');
    setPage(0);
  };

  const hasVisibleProducts = hasLoadedData && loadedOrgIdRef.current === activeOrg?.id;
  if (!hasVisibleProducts) {
    if (!online) {
      return <WorkspaceState kind="offline" title="Productos sin conexión" description="No pudimos leer el catálogo. Volvé a conectarte para reintentar sin mostrar información incompleta." actionLabel="Reintentar" onAction={() => void reload()} />;
    }
    if (loadError) {
      return <WorkspaceState kind="error-recoverable" title="No pudimos abrir Productos" description={loadError} actionLabel="Reintentar" onAction={() => void reload()} />;
    }
    return <WorkspaceState kind="initial-loading" title="Leyendo catálogo de productos" loadingRows={8} />;
  }

  // ⚠️ Lo que no lleva stock no puede estar «sin stock». Un servicio —un corte
  // de pelo, una hora de consultoría— se vende y no se descuenta, así que se
  // queda en el valor con el que se cargó (0 por default) y aparecía como
  // agotado para siempre, inflando la alerta que el comercio sí tiene que
  // mirar. `maneja_stock` viene en el `select('*')` de `getProductsDB`.
  const conStock = products.filter(p => p.maneja_stock !== false);
  const lowStockCount = conStock.filter(p => p.stock > 0 && p.stock <= 3).length;
  const outOfStockCount = conStock.filter(p => p.stock <= 0).length;

  return (
    <div className="workspace-page workspace-products space-y-5 pb-12">
      <PageHeader
        icon={Package}
        title="Productos"
        description={`${filtered.length} de ${plural(products.length, "producto")} · ${totalStock} uds`}
        badge={
          outOfStockCount > 0
            ? { label: `${outOfStockCount} sin stock`, variant: "destructive" }
            : lowStockCount > 0
            ? { label: `${lowStockCount} stock bajo`, variant: "warning" }
            : expiringSoon.length > 0
            ? { label: `${expiringSoon.length} por vencer`, variant: "warning" }
            : undefined
        }
        actions={
          <div className="workspace-products-actions flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => void reload()} disabled={refreshing} title="Actualizar catálogo">
              <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />Actualizar
            </Button>
            <div className="flex rounded-lg border border-border overflow-hidden h-9">
              <button onClick={() => setProductView('list')} className={`px-2.5 transition-colors ${productView === 'list' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`} title="Vista lista">
                <List className="w-4 h-4" />
              </button>
              <button onClick={() => setProductView('grid')} className={`px-2.5 transition-colors ${productView === 'grid' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`} title="Vista grilla">
                <LayoutGrid className="w-4 h-4" />
              </button>
            </div>
            <Button variant="outline" size="sm" onClick={() => exportProductsXLSX(filtered, settings)}>
              <FileSpreadsheet className="w-4 h-4 mr-2" />Excel
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportPriceListPDF(filtered, settings?.business_name || "Mi Negocio")} title="Exportar lista de precios para imprimir">
              <FileText className="w-4 h-4 mr-2" />Lista precios
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportPriceLabels(filtered, settings?.business_name || "Mi Negocio")} title="Imprimir etiquetas de precio (55×32mm) para cada producto">
              <Tag className="w-4 h-4 mr-2" />Etiquetas precio
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportQRLabels(filtered, settings?.business_name || "Mi Negocio")} title="Imprimir etiquetas QR por producto">
              <QrCode className="w-4 h-4 mr-2" />Etiquetas QR
            </Button>
            <Button variant="outline" size="sm" onClick={() => setBarcodeOpen(true)} title="Imprimir etiquetas con código de barras">
              <Layers className="w-4 h-4 mr-2" />Barcodes
            </Button>
            {(activeRole === 'owner' || activeRole === 'admin') && (
              <Button variant="outline" size="sm" onClick={() => setImportOpen(true)} title="Importar Excel o CSV con validación y reconciliación">
                <Upload className="w-4 h-4 mr-2" />Importar Excel/CSV
              </Button>
            )}
            {canEdit && activeOrg?.id && (
              <Button variant="outline" size="sm" onClick={() => setProductTypesOpen(true)} title="Configurar tipos y atributos del catálogo">
                <Layers className="w-4 h-4 mr-2" />Tipos y atributos
              </Button>
            )}
            {canEdit && (
              <Button variant="outline" size="sm" onClick={() => setBulkOpen(true)} className="hidden md:flex">
                <TrendingUp className="w-4 h-4 mr-2" />Ajuste masivo
              </Button>
            )}
            {canEdit && (
              <Button variant="outline" size="sm" onClick={() => setCatOfferOpen(true)} title="Aplicar oferta a toda una categoría">
                <Tag className="w-4 h-4 mr-2" />Oferta x categoría
              </Button>
            )}
            {canEdit && (
              <Button
                variant="outline" size="sm" onClick={() => setPesosOpen(true)}
                title="Estimar el peso a partir del contenido, para que el envío no se cotice con el valor por defecto"
              >
                <Scale className="w-4 h-4 mr-2" />Completar pesos
              </Button>
            )}
            <Button variant="outline" size="sm" title="Calculadora de rentabilidad" onClick={() => { setCalcProduct(null); setCalcOpen(true); }}>
              <Calculator className="w-4 h-4 mr-2" />Calculadora
            </Button>
            {canCreate && (productLimit !== null && products.length >= productLimit ? (
              <Button
                className="gradient-gold text-primary-foreground font-semibold shadow-gold"
                onClick={() => toast.error(`Límite de ${plural(productLimit, "producto")} alcanzado en el plan ${plan?.name}. Actualizá tu plan.`)}
              >
                <Plus className="w-4 h-4 mr-2" />Nuevo
              </Button>
            ) : (
              <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) setEditing(null); }}>
                <DialogTrigger asChild>
                  <Button className="gradient-gold text-primary-foreground font-semibold shadow-gold"><Plus className="w-4 h-4 mr-2" />Nuevo</Button>
                </DialogTrigger>
                <DialogContent className="bg-card border-border max-h-[90vh] overflow-y-auto">
                  <DialogHeader><DialogTitle className="font-display">{editing ? 'Editar' : 'Nuevo'} Producto</DialogTitle></DialogHeader>
                  <ProductForm product={editing} settings={settings} userId={user!.id} orgId={activeOrg?.id} onSave={() => { setOpen(false); setEditing(null); reload(); }} />
                </DialogContent>
              </Dialog>
            ))}
          </div>
        }
      />

      {refreshing && (
        <WorkspaceState kind="refreshing" layout="banner" title="Actualizando catálogo" description="Mantenemos visible la última lectura válida mientras consultamos productos y datos relacionados." />
      )}
      {!online && (
        <WorkspaceState
          kind="offline"
          layout="banner"
          title="Catálogo sin conexión"
          description={`Seguís viendo la última lectura válida${lastLoadedAt ? ` de las ${lastLoadedAt.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}` : ''}. Los cambios requieren conexión.`}
          actionLabel="Reintentar"
          onAction={() => void reload()}
        />
      )}
      {online && loadError && (
        <WorkspaceState
          kind="stale"
          layout="banner"
          title="No pudimos actualizar el catálogo"
          description={`${loadError}${lastLoadedAt ? ` Seguís viendo la lectura de las ${lastLoadedAt.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}.` : ''}`}
          actionLabel="Reintentar"
          onAction={() => void reload()}
        />
      )}
      {partialWarning && (
        <WorkspaceState kind="partial" layout="banner" title="Catálogo con cobertura parcial" description={partialWarning} actionLabel="Reintentar datos faltantes" onAction={() => void reload()} />
      )}

      {activeOrg?.id && (
        <ProductTypesManager
          orgId={activeOrg.id}
          open={productTypesOpen}
          onOpenChange={setProductTypesOpen}
          canConfigureProfile={activeRole === 'owner' || activeRole === 'admin'}
        />
      )}

      <CalidadPublicaciones
        productos={paraCalidad}
        filtroActivo={filterCalidad}
        onFiltrar={setFilterCalidad}
      />

      {activeOrg?.id && (
        <IdentityHealthPanel
          entity="products"
          orgId={activeOrg.id}
          onOpenProduct={canEdit ? (id) => {
            const product = products.find(item => item.id === id);
            if (!product) return;
            setEditing(product);
            setOpen(true);
          } : undefined}
        />
      )}

      <WorkspaceViewTabs
        ariaLabel="Vistas del catálogo"
        activeTab={productsWorkspaceTab}
        onChange={(tab) => setProductsWorkspaceTab(tab as "catalog" | "overview")}
        tabs={[
          { id: "catalog", label: "Catálogo", icon: Package, count: filtered.length },
          { id: "overview", label: "Operación", icon: BarChart2, count: `${plural(lowStockCount + outOfStockCount, "alerta")}` },
        ]}
        meta={<span>{products.length} productos · {totalStock} unidades</span>}
      />

      {productsWorkspaceTab === "overview" && (
      <>
      {sinCostoUtilizable > 0 && (
        <div className="rounded-[10px] border border-amber-500/30 bg-amber-500/10 p-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
            <div className="flex-1 min-w-0 text-sm">
              <p className="font-semibold text-amber-400">
                {sinCostoUtilizable} producto{sinCostoUtilizable !== 1 ? 's' : ''} sin costo calculable
              </p>
              <p className="text-xs text-amber-300/80 mt-0.5">
                Su costo está en dólares y todavía no hay tipo de cambio cargado, así que
                el margen y la ganancia de {sinCostoUtilizable !== 1 ? 'esos productos' : 'ese producto'} no
                se pueden calcular. No se muestran en cero: no se sabe.
              </p>
              <button
                onClick={() => navigate('/settings#finance')}
                className="text-xs text-amber-400 underline underline-offset-2 mt-1.5"
              >
                Cargar el tipo de cambio en Ajustes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* KPI row */}
      <div className="workspace-products-kpis grid grid-cols-2 md:grid-cols-5 gap-3">
        <KPICard label="Total productos" value={products.length} icon={Package} color="primary"
          sub={productLimit ? `${products.length}/${productLimit} del plan` : `${filtered.length} visibles`} />
        <KPICard label="Inversión total" value={formatUSD(totalValue)} icon={DollarSign} color="blue"
          sub={`${plural(totalStock, "unidad", "unidades")} en stock`} />
        <KPICard label="Stock bajo" value={lowStockCount} icon={AlertTriangle}
          color={lowStockCount > 0 ? "warning" : "success"} sub="1–3 unidades" />
        <KPICard label="Sin stock" value={outOfStockCount} icon={X}
          color={outOfStockCount > 0 ? "destructive" : "success"} sub="agotados" />
        <button
          onClick={() => setFilterExpiry(expired.length > 0 ? 'expired' : 'soon30')}
          className="text-left"
          title="Ver productos vencidos o por vencer"
        >
          <KPICard
            label="Vencidos / en riesgo"
            value={`${expired.length} / ${critical.length}`}
            icon={Clock}
            color={expired.length > 0 ? "destructive" : totalAtRisk > 0 ? "warning" : "success"}
            sub={totalAtRisk > 0 ? `${totalAtRisk} con stock en riesgo` : warning.length > 0 ? `${warning.length} próximos a vencer` : "Sin vencimientos urgentes"}
          />
        </button>
      </div>
      </>
      )}

      {/* Bulk price adjustment modal */}
      {/* Sobre la selección; sin selección, sobre lo filtrado. Es lo que hace
          que el filtro "sin peso" del panel de calidad termine en un arreglo y
          no en una lista de reproches. */}
      <CompletarPesos
        open={pesosOpen}
        onOpenChange={setPesosOpen}
        productos={(selectedIds.size > 0
          ? filteredSorted.filter((p: any) => selectedIds.has(p.id))
          : filteredSorted) as any}
        onDone={reload}
      />

      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="bg-card border-border max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display">Ajuste Masivo de Precios</DialogTitle></DialogHeader>
          {/* Las categorías bajan por prop: la página ya las tiene cargadas y
              volver a pedirlas acá sería la misma consulta dos veces. */}
          <BulkPriceAdjust userId={user!.id} settings={settings} categorias={opcionesCategoria} onDone={() => { setBulkOpen(false); reload(); }} />
        </DialogContent>
      </Dialog>

      {/* Importación unificada: el servidor valida antes de tocar catálogo o stock. */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="bg-card border-border max-w-5xl">
          <ProductsExcelImport onClose={() => setImportOpen(false)} onImported={reload} />
        </DialogContent>
      </Dialog>

      {/* Price history modal */}
      <PriceHistoryModal
        productId={priceHistoryProduct?.id || ""}
        productName={priceHistoryProduct?.name || ""}
        open={!!priceHistoryProduct}
        onClose={() => setPriceHistoryProduct(null)}
      />

      <PerfumeRecommenderModal
        open={!!recoTargetId}
        onOpenChange={(v) => { if (!v) setRecoTargetId(null); }}
        title="Perfumes similares"
        subtitle={recoTargetId ? `Parecidos a ${products.find(p => p.id === recoTargetId)?.name || ""} por familia y notas` : undefined}
        results={recoTargetId ? recommendSimilar(recoTargetId, products, perfumeDetailsByProduct) : []}
        onPick={(prod) => { setRecoTargetId(null); setEditing(prod); setOpen(true); }}
      />

      {/* ── Oferta masiva por categoría ─────────────────────────────── */}
      <Dialog open={catOfferOpen} onOpenChange={setCatOfferOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Tag className="w-4 h-4 text-primary" />Oferta por categoría</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Categoría</label>
              <Select value={catOfferCategory} onValueChange={setCatOfferCategory}>
                <SelectTrigger className="bg-muted border-border"><SelectValue placeholder="Elegí una categoría" /></SelectTrigger>
                <SelectContent>
                  {opcionesCategoria.map(o => (
                    <SelectItem key={o.slug} value={o.slug}>
                      {o.nivel > 0 ? `  ${o.label}` : o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground mt-1">{catOfferProducts.length} productos en esta categoría · {catOfferProducts.filter(p => p.discount_price_ars).length} con oferta activa</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Descuento %</label>
                <Input type="number" min="1" max="99" value={catOfferPct} onChange={e => setCatOfferPct(e.target.value)} className="bg-muted border-border" />
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Vence (opcional)</label>
                <Input type="datetime-local" value={catOfferExpiry} onChange={e => setCatOfferExpiry(e.target.value)} className="bg-muted border-border text-xs" />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">Se aplica a todos los productos de la categoría: precio c/desc = Venta × (1 − {catOfferPct || 0}%).</p>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={clearCategoryOffer} disabled={catOfferSaving} className="text-destructive">Quitar ofertas</Button>
            <Button onClick={applyCategoryOffer} disabled={catOfferSaving || catOfferProducts.length === 0}>
              {catOfferSaving ? "Aplicando…" : `Aplicar a ${catOfferProducts.length}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {productsWorkspaceTab === "overview" && (
      <>
      {(expired.length > 0 || critical.length > 0 || warning.length > 0) && (
        <div className={`rounded-xl border px-4 py-3 ${
          expired.length > 0
            ? "bg-red-500/10 border-red-500/30"
            : critical.length > 0
            ? "bg-orange-500/10 border-orange-500/30"
            : "bg-yellow-500/10 border-yellow-500/30"
        }`}>
          <div className="flex items-start gap-3">
            <AlertTriangle className={`w-4 h-4 shrink-0 mt-0.5 ${expired.length > 0 ? "text-red-400" : critical.length > 0 ? "text-orange-400" : "text-yellow-400"}`} />
            <div className="flex-1 min-w-0 text-sm space-y-1">
              {expired.length > 0 && (
                <div>
                  <span className="font-semibold text-red-400">{expired.length} vencido{expired.length !== 1 ? 's' : ''}: </span>
                  <span className="text-red-300/80">{expired.slice(0, 2).map(p => `${p.name} (${p.expiryLabel})`).join(', ')}{expired.length > 2 ? ` +${expired.length - 2}` : ''}</span>
                </div>
              )}
              {critical.length > 0 && (
                <div>
                  <span className="font-semibold text-orange-400">{critical.length} vence{critical.length !== 1 ? 'n' : ''} en ≤7 días: </span>
                  <span className="text-orange-300/80">{critical.slice(0, 2).map(p => `${p.name} (${p.daysUntil}d)`).join(', ')}{critical.length > 2 ? ` +${critical.length - 2}` : ''}</span>
                </div>
              )}
              {warning.length > 0 && expired.length === 0 && critical.length === 0 && (
                <div>
                  <span className="font-semibold text-yellow-400">{warning.length} vence{warning.length !== 1 ? 'n' : ''} en ≤30 días: </span>
                  <span className="text-yellow-300/80">{warning.slice(0, 3).map(p => p.name).join(', ')}{warning.length > 3 ? ` +${warning.length - 3}` : ''}</span>
                </div>
              )}
            </div>
            <div className="flex gap-1.5 shrink-0">
              {expired.length > 0 && (
                <button onClick={() => setFilterExpiry('expired')} className="text-xs text-red-400 hover:underline">Ver vencidos</button>
              )}
              {(critical.length > 0 || warning.length > 0) && (
                <button onClick={() => setFilterExpiry('soon30')} className="text-xs text-orange-400 hover:underline">Ver próximos</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Inventory Aging Panel ─────────────────────────────────── */}
      {(() => {
        const now = today.getTime();
        const withStock = products.filter(p => p.stock > 0);
        const aged = withStock.map(p => {
          const last = lastSaleDate[p.id];
          const daysSince = last ? Math.floor((now - new Date(last + 'T12:00:00').getTime()) / 86400000) : 999;
          const costUSD = Number(p.cost_usd || 0);
          const exchangeRate = Number(p.exchange_rate || 900);
          const valueARS = costUSD * exchangeRate * Number(p.stock);
          return { ...p, daysSince, valueARS };
        }).filter(p => p.daysSince > 30);
        if (aged.length === 0) return null;
        const buckets = [
          { label: '31–60 días', min: 31, max: 60, color: 'text-amber-400 bg-amber-500/10 border-amber-500/20', barColor: 'bg-amber-400' },
          { label: '61–90 días', min: 61, max: 90, color: 'text-orange-400 bg-orange-500/10 border-orange-500/20', barColor: 'bg-orange-400' },
          { label: '90+ días',   min: 91, max: 9999, color: 'text-destructive bg-destructive/10 border-destructive/20', barColor: 'bg-destructive' },
          { label: 'Nunca vendido', min: 998, max: 9999, color: 'text-muted-foreground bg-muted/20 border-border', barColor: 'bg-muted-foreground' },
        ];
        const grouped2 = buckets.map(b => ({
          ...b,
          items: aged.filter(p => b.label === 'Nunca vendido' ? p.daysSince >= 999 : (p.daysSince >= b.min && p.daysSince < b.max && p.daysSince < 999)),
        })).filter(b => b.items.length > 0);
        const totalAtRisk = aged.reduce((s, p) => s + p.valueARS, 0);
        return (
          <div className="workspace-products-aging bg-card border border-border rounded-xl overflow-hidden">
            <div className="flex items-center w-full gap-2 pr-2">
              <button
                onClick={() => setShowAging(!showAging)}
                className="flex-1 flex items-center gap-2 px-4 py-3 hover:bg-muted/20 transition-colors text-left"
              >
                <BarChart2 className="w-4 h-4 text-amber-400" />
                <span className="text-sm font-semibold">Análisis de aging — inventario sin movimiento</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 font-medium">{aged.length} productos</span>
                <span className="text-xs text-muted-foreground hidden sm:inline">· {formatUSD(totalAtRisk / 900)} en riesgo</span>
              </button>
              <button
                onClick={e => { e.stopPropagation(); printAgingPDF(aged, settings?.business_name || "Mi Negocio", Number(settings?.exchange_rate) || 900); }}
                className="shrink-0 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                title="Exportar PDF de productos sin movimiento"
              >
                <FileDown className="w-4 h-4" />
              </button>
              {showAging ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
            </div>
            {showAging && (
              <div className="border-t border-border px-4 pb-4 pt-3 space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {grouped2.map(b => (
                    <div key={b.label} className={`rounded-lg border px-3 py-2 text-xs ${b.color}`}>
                      <p className="font-semibold">{b.label}</p>
                      <p className="text-lg font-bold mt-0.5">{b.items.length}</p>
                      <p className="opacity-70">{formatUSD(b.items.reduce((s, p) => s + p.valueARS, 0) / 900)} inversión</p>
                    </div>
                  ))}
                </div>
                {grouped2.map(b => (
                  <div key={b.label}>
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">{b.label} ({b.items.length})</h4>
                    <div className="space-y-1 pb-12">
                      {b.items.slice(0, 8).map(p => {
                        const totalProducts = b.items.reduce((s, x) => s + x.valueARS, 0);
                        const pct = totalProducts > 0 ? (p.valueARS / totalProducts) * 100 : 0;
                        return (
                          <div key={p.id} className="flex items-center gap-3 text-xs">
                            <span className="flex-1 truncate font-medium">{p.name}</span>
                            <span className="text-muted-foreground shrink-0">{p.stock} uds</span>
                            <div className="hidden sm:flex items-center gap-1 w-20 shrink-0">
                              <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                                <div className={`h-full ${b.barColor}`} style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                            <button
                              onClick={() => { setFilterMovement('no30'); setSearch(p.name); setPage(0); }}
                              className="text-[10px] text-primary hover:underline shrink-0"
                            >
                              Ver
                            </button>
                          </div>
                        );
                      })}
                      {b.items.length > 8 && (
                        <p className="text-[10px] text-muted-foreground">+{b.items.length - 8} más — filtrá por "Sin venta 30+ días"</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}
      </>
      )}

      {productsWorkspaceTab === "catalog" && (
      <>
      <div className="workspace-products-filters flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Buscar..." value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} className="pl-9 bg-muted border-border h-9 text-sm" />
        </div>
        <div className="flex gap-2 flex-wrap">
          <Select value={filterCat} onValueChange={v => { setFilterCat(v); setPage(0); }}>
            <SelectTrigger className="w-[130px] bg-muted border-border h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas cat.</SelectItem>
              {/* Un filtro no crea nada: sólo ofrece lo que existe. */}
              {opcionesCategoria.map(o => (
                <SelectItem key={o.slug} value={o.slug}>
                  {o.nivel > 0 ? `  ${o.label}` : o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterStock} onValueChange={v => { setFilterStock(v); setPage(0); }}>
            <SelectTrigger className="w-[120px] bg-muted border-border h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todo</SelectItem>
              <SelectItem value="instock">En stock</SelectItem>
              <SelectItem value="low">Stock bajo</SelectItem>
              <SelectItem value="out">Sin stock</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterExpiry} onValueChange={v => { setFilterExpiry(v); setPage(0); }}>
            <SelectTrigger className="w-[130px] bg-muted border-border h-9 text-sm"><SelectValue placeholder="Vencimiento" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Venc.: Todos</SelectItem>
              <SelectItem value="has_expiry">Con vencimiento</SelectItem>
              <SelectItem value="soon30">Vence en 30 días</SelectItem>
              <SelectItem value="soon90">Vence en 90 días</SelectItem>
              <SelectItem value="expired">Vencidos</SelectItem>
            </SelectContent>
          </Select>
          {allTags.length > 0 && (
            <Select value={filterTag || '__all'} onValueChange={v => { setFilterTag(v === '__all' ? '' : v); setPage(0); }}>
              <SelectTrigger className="w-[120px] bg-muted border-border h-9 text-sm"><SelectValue placeholder="Etiqueta" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Etiquetas: todas</SelectItem>
                {allTags.map((t: string) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Select value={filterMovement} onValueChange={v => { setFilterMovement(v); setPage(0); }}>
            <SelectTrigger className="w-[150px] bg-muted border-border h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Movimiento: todos</SelectItem>
              <SelectItem value="no30">Sin venta 30+ días</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterMargin} onValueChange={v => { setFilterMargin(v); setPage(0); }}>
            <SelectTrigger className="w-[150px] bg-muted border-border h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Margen: todos</SelectItem>
              <SelectItem value="high">&gt;40% (alto)</SelectItem>
              <SelectItem value="mid">20–40% (medio)</SelectItem>
              <SelectItem value="low">&lt;20% (bajo)</SelectItem>
              <SelectItem value="negative">Negativo</SelectItem>
            </SelectContent>
          </Select>
          <button
            onClick={() => { setFilterDiscount(v => !v); setPage(0); }}
            className={`h-9 px-3 text-xs rounded-lg border transition-colors font-medium shrink-0 ${filterDiscount ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40' : 'bg-muted text-muted-foreground border-border hover:text-foreground'}`}
          >
            <Tag className="w-3.5 h-3.5 inline mr-1" />Con oferta
          </button>
          <Sheet open={facetSheetOpen} onOpenChange={setFacetSheetOpen}>
            <SheetTrigger asChild>
              <button
                className={`h-9 px-3 text-xs rounded-lg border transition-colors font-medium shrink-0 ${facetCount > 0 ? 'bg-primary/20 text-primary border-primary/40' : 'bg-muted text-muted-foreground border-border hover:text-foreground'}`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5 inline mr-1" />Buscador perfume
                {facetCount > 0 && <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground text-[9px] font-bold">{facetCount}</span>}
              </button>
            </SheetTrigger>
            <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2"><Droplets className="w-4 h-4 text-primary" />Buscador de perfumes</SheetTitle>
              </SheetHeader>
              <div className="mt-4 space-y-4">
                <p className="text-[11px] text-muted-foreground">Filtrá por características olfativas. Ej: masculino + dulce + vainilla + larga duración, hasta $80.000.</p>
                <div>
                  <p className="text-xs font-semibold mb-1.5">Género</p>
                  <ChipSelect items={GENEROS} selected={filterGenderFacet} onToggle={v => { setFilterGenderFacet(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]); setPage(0); }} />
                </div>
                <div>
                  <p className="text-xs font-semibold mb-1.5">Familia olfativa</p>
                  <ChipSelect items={FAMILIAS_OLFATIVAS} selected={filterFamilia} onToggle={v => { setFilterFamilia(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]); setPage(0); }} />
                </div>
                <div>
                  <p className="text-xs font-semibold mb-1.5">Notas</p>
                  <ChipSelect items={NOTAS_COMUNES} selected={filterNotas} onToggle={v => { setFilterNotas(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]); setPage(0); }} />
                </div>
                <div>
                  <p className="text-xs font-semibold mb-1.5">Estación</p>
                  <ChipSelect items={ESTACIONES} selected={filterEstacion} onToggle={v => { setFilterEstacion(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]); setPage(0); }} />
                </div>
                <div>
                  <p className="text-xs font-semibold mb-1.5">Ocasión</p>
                  <ChipSelect items={OCASIONES} selected={filterOcasion} onToggle={v => { setFilterOcasion(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]); setPage(0); }} />
                </div>
                <div>
                  <p className="text-xs font-semibold mb-1.5">Precio máximo (ARS)</p>
                  <Input type="number" min="0" value={filterMaxPrice} onChange={e => { setFilterMaxPrice(e.target.value); setPage(0); }} placeholder="Ej: 80000" className="bg-muted border-border h-9 text-sm" />
                </div>
                <div className="flex gap-2 pt-2">
                  <Button type="button" variant="outline" size="sm" className="flex-1"
                    onClick={() => { setFilterFamilia([]); setFilterNotas([]); setFilterEstacion([]); setFilterOcasion([]); setFilterGenderFacet([]); setFilterMaxPrice(''); setPage(0); }}>
                    Limpiar
                  </Button>
                  <Button type="button" size="sm" className="flex-1" onClick={() => setFacetSheetOpen(false)}>
                    Ver {filtered.length} resultado{filtered.length === 1 ? '' : 's'}
                  </Button>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {!filtered.length ? (
        <WorkspaceState
          kind={products.length === 0 ? "empty-first-use" : "empty-filtered"}
          icon={Package}
          title={products.length === 0 ? 'Todavía no hay productos' : 'Ningún producto coincide'}
          description={products.length === 0
            ? (canCreate ? 'Creá el primer producto para activar catálogo, stock y rentabilidad por canal.' : 'Tu organización todavía no cargó productos.')
            : 'Limpiá los filtros para volver a ver el catálogo completo.'}
          actionLabel={products.length === 0
            ? (canCreate && (productLimit === null || products.length < productLimit) ? 'Nuevo producto' : undefined)
            : 'Limpiar filtros'}
          onAction={products.length === 0
            ? (canCreate && (productLimit === null || products.length < productLimit) ? () => setOpen(true) : undefined)
            : clearProductFilters}
        />
      ) : productView === 'grid' ? (
        <div className="workspace-products-grid grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {filteredSorted.map((p: any) => (
            <div key={p.id} className="workspace-products-grid-card bg-card border border-border rounded-xl overflow-hidden group hover:border-primary/40 transition-colors">
              <div className="relative aspect-square bg-muted/30">
                {p.image_url
                  ? <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center"><Package className="w-8 h-8 text-muted-foreground/30" /></div>
                }
                {p.stock <= 0 && <span className="absolute top-1 right-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-destructive text-white">SIN STOCK</span>}
                {p.discount_price_ars && Number(p.discount_price_ars) < Number(p.sale_price_ars) && (
                  <div className="absolute top-1 left-1 flex flex-col gap-0.5">
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-orange-500 text-white">OFERTA</span>
                    {p.offer_expires_at && (
                      <span className="px-1.5 py-0.5 rounded bg-black/70 leading-tight">
                        <OfferCountdownBadge expiresAt={p.offer_expires_at} />
                      </span>
                    )}
                  </div>
                )}
                <div className="absolute bottom-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                  {perfumeDetailsByProduct[p.id] && (
                    <button onClick={() => setRecoTargetId(p.id)} title="Perfumes similares" className="p-1 rounded bg-card/90 hover:bg-card border border-border">
                      <Sparkles className="w-3 h-3 text-primary" />
                    </button>
                  )}
                  {canEdit && (
                    <button onClick={() => { setEditing(p); setOpen(true); }} className="p-1 rounded bg-card/90 hover:bg-card border border-border">
                      <Pencil className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
              <div className="p-2">
                <p className="text-xs font-medium leading-tight line-clamp-2 mb-1">{p.name}</p>
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-bold text-primary">{formatARS(Number(p.discount_price_ars && Number(p.discount_price_ars) < Number(p.sale_price_ars) ? p.discount_price_ars : p.sale_price_ars))}</span>
                  <span className={`text-[10px] font-medium ${p.stock > 0 ? 'text-emerald-400' : 'text-destructive'}`}>×{p.stock}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          {Object.entries(grouped).sort(([a],[b]) => a.localeCompare(b)).map(([brand, items]) => (
            <div key={brand} className="workspace-products-brand-group mb-6">
              <h2 className="text-sm font-display font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                {brand} <span className="text-xs font-normal">({items.length} · {items.reduce((s: number, p: any) => s + p.stock, 0)} uds)</span>
              </h2>
              <div className="workspace-products-table-shell hidden md:block bg-card border border-border rounded-lg overflow-x-auto">
                <table className="workspace-products-table w-full text-sm">
                  <thead>
                     <tr className="border-b border-border text-muted-foreground">
                       <th className="p-3 w-8">
                         <button onClick={toggleSelectAll} className="text-muted-foreground hover:text-foreground transition-colors">
                           {selectedIds.size > 0 && selectedIds.size === filteredSorted.length ? <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4" />}
                         </button>
                       </th>
                       {([
                         { col: "name" as const, label: "Nombre", align: "left" },
                       ]).map(h => (
                         <th key={h.col} className={`text-${h.align} p-3 font-medium cursor-pointer hover:text-foreground select-none`}
                           onClick={() => setProductSort(s => ({ col: h.col, dir: s.col === h.col && s.dir === "asc" ? "desc" : "asc" }))}>
                           <span className="inline-flex items-center gap-1">{h.label}
                             {productSort.col === h.col ? (productSort.dir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />) : null}
                           </span>
                         </th>
                       ))}
                       <th className="text-center p-3 font-medium">Gen.</th>
                       <th className="text-left p-3 font-medium">Cat.</th>
                       <th className="text-right p-3 font-medium">Costo</th>
                       {([
                         { col: "sale_price_ars" as const, label: "Venta" },
                       ]).map(h => (
                         <th key={h.col} className="text-right p-3 font-medium cursor-pointer hover:text-foreground select-none"
                           onClick={() => setProductSort(s => ({ col: h.col, dir: s.col === h.col && s.dir === "desc" ? "asc" : "desc" }))}>
                           <span className="inline-flex items-center gap-1 justify-end">{h.label}
                             {productSort.col === h.col ? (productSort.dir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />) : null}
                           </span>
                         </th>
                       ))}
                       <th className="text-right p-3 font-medium">Oferta</th>
                       <th className="p-3 font-medium hidden lg:table-cell" title="Tendencia de precio (historial)">Tendencia</th>
                       <th className="text-right p-3 font-medium cursor-pointer hover:text-foreground select-none"
                         onClick={() => setProductSort(s => ({ col: "margin", dir: s.col === "margin" && s.dir === "desc" ? "asc" : "desc" }))}>
                         <span className="inline-flex items-center gap-1 justify-end">Ganancia
                           {productSort.col === "margin" ? (productSort.dir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />) : null}
                         </span>
                       </th>
                       <th className="text-right p-3 font-medium cursor-pointer hover:text-foreground select-none"
                         onClick={() => setProductSort(s => ({ col: "stock", dir: s.col === "stock" && s.dir === "desc" ? "asc" : "desc" }))}>
                         <span className="inline-flex items-center gap-1 justify-end">Stock
                           {productSort.col === "stock" ? (productSort.dir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />) : null}
                         </span>
                       </th>
                       <th className="text-right p-3 font-medium hidden xl:table-cell" title="Umbral de alerta de stock bajo — click para editar">Alerta</th>
                       <th className="text-right p-3 font-medium" title="Días de stock restante según velocidad de ventas (últimos 60 días)">Días ⚡</th>
                       <th className="text-right p-3 font-medium" title="Días desde la última venta registrada (últimos 60 días)">Sin mvto</th>
                       <th className="text-center p-3 font-medium">Mod.</th>
                       <th className="text-center p-3 font-medium">Acc.</th>
                     </tr>
                  </thead>
                  <tbody>
                     {items.map((p: any) => (
                       <tr key={p.id} className={`border-b border-border last:border-0 hover:bg-muted/30 transition-colors ${selectedIds.has(p.id) ? 'bg-primary/5' : ''}`}>
                          <td className="p-3 w-8">
                            <button onClick={() => setSelectedIds(prev => { const s = new Set(prev); if (s.has(p.id)) s.delete(p.id); else s.add(p.id); return s; })} className="text-muted-foreground hover:text-primary transition-colors">
                              {selectedIds.has(p.id) ? <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4" />}
                            </button>
                          </td>
                          <td className="p-3 font-medium max-w-[200px] truncate">
                            <div className="flex items-center gap-2">
                              {p.image_url && <img src={p.image_url} alt="" className="w-8 h-8 rounded object-cover" />}
                              <span className="truncate">{p.name}</span>
                              {/* El puntaje de la ficha, sólo si no está completa:
                                  un catálogo lleno de números verdes no dice nada. */}
                              <BadgeCalidad producto={calidadPorProducto.get(p.id) ?? p} />
                              {p.featured && <Star className="w-3 h-3 text-primary shrink-0" fill="currentColor" />}
                              {variantCounts[p.id] > 0 && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/15 text-emerald-400 shrink-0 flex items-center gap-0.5" title={`${variantCounts[p.id]} sabores/variantes`}>
                                  <Layers className="w-2.5 h-2.5" />{variantCounts[p.id]}
                                </span>
                              )}
                              {p.expiry_date && (() => {
                                const exp = new Date(p.expiry_date);
                                const isExpired = exp < today;
                                const isSoon = exp <= in30Days;
                                if (!isExpired && !isSoon) return null;
                                return (
                                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 ${isExpired ? 'bg-destructive/20 text-destructive' : 'bg-orange-500/20 text-orange-400'}`} title={`Vence: ${exp.toLocaleDateString('es-AR')}`}>
                                    {isExpired ? 'VENC.' : 'PROX.'}
                                  </span>
                                );
                              })()}
                              {(p.tags || []).slice(0, 2).map((t: string) => (
                                <span key={t} className="px-1.5 py-0.5 rounded-full text-[9px] bg-primary/10 text-primary shrink-0">{t}</span>
                              ))}
                            </div>
                          </td>
                         <td className="p-3 text-center">{GENDER_ICONS[p.gender] || ''}</td>
                         <td className="p-3"><span className={`px-2 py-0.5 rounded-full text-xs ${colorDeCategoria(p.category)}`}>{nombreCategoria(p.category)}</span></td>
                         <td className="p-3 text-right text-xs">{formatUSD(Number(p.total_cost_usd))}</td>
                         <td className="p-3 text-right font-medium text-xs">{Number(p.sale_price_ars) > 0 ? formatARS(Number(p.sale_price_ars)) : '—'}</td>
                         <td className="p-3 text-right text-xs">{p.discount_price_ars ? <span className="text-yellow-400">{formatARS(Number(p.discount_price_ars))}</span> : '—'}</td>
                         <td className="p-3 hidden lg:table-cell">
                           <PriceSparkline productId={p.id} orgId={activeOrg?.id} width={72} />
                         </td>
                         <td className="p-3 text-right">
                           {(() => {
                             const margin = Number(p.sale_price_ars) > 0 ? (Number(p.profit_per_unit_ars) / Number(p.sale_price_ars)) * 100 : 0;
                             const isLowMargin = margin < 30 && margin > 0;
                             return (
                               <span className={`text-xs flex items-center justify-end gap-1 ${Number(p.profit_per_unit_ars) > 0 ? (isLowMargin ? 'text-yellow-400' : 'text-emerald-400') : 'text-destructive'}`}>
                                 {isLowMargin && <AlertTriangle className="w-3 h-3" />}
                                 {formatARS(Number(p.profit_per_unit_ars))}
                                 <span className="text-[10px] text-muted-foreground">({Math.round(margin)}%)</span>
                               </span>
                             );
                           })()}
                         </td>
                         <td className="p-3 text-right">
                           {editingStock?.id === p.id ? (
                             <input
                               type="number"
                               min="0"
                               autoFocus
                               value={editingStock.value}
                               onChange={e => setEditingStock({ id: p.id, value: e.target.value })}
                               onBlur={() => saveInlineStock(p.id, editingStock.value)}
                               onKeyDown={e => {
                                 if (e.key === "Enter") saveInlineStock(p.id, editingStock.value);
                                 if (e.key === "Escape") setEditingStock(null);
                               }}
                               className="w-16 text-right text-xs border border-primary/40 rounded bg-background px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary/60"
                             />
                           ) : (
                             <button
                               onClick={() => setEditingStock({ id: p.id, value: String(p.stock) })}
                               className="group relative"
                               title="Click para editar stock"
                             >
                               {p.stock <= 0 ? (
                                 <span className="text-xs text-muted-foreground group-hover:text-primary transition-colors">0</span>
                               ) : p.stock <= 3 ? (
                                 <span className="text-destructive font-bold flex items-center justify-end gap-1 group-hover:text-primary transition-colors"><AlertTriangle className="w-3 h-3" />{p.stock}</span>
                               ) : (
                                 <span className="text-emerald-400 font-medium group-hover:text-primary transition-colors">{p.stock}</span>
                               )}
                             </button>
                           )}
                         </td>
                         <td className="p-3 text-right hidden xl:table-cell">
                           {editingThreshold?.id === p.id ? (
                             <input
                               type="number" min="0" autoFocus
                               value={editingThreshold.value}
                               onChange={e => setEditingThreshold({ id: p.id, value: e.target.value })}
                               onBlur={() => saveInlineThreshold(p.id, editingThreshold.value)}
                               onKeyDown={e => {
                                 if (e.key === "Enter") saveInlineThreshold(p.id, editingThreshold.value);
                                 if (e.key === "Escape") setEditingThreshold(null);
                               }}
                               className="w-14 text-right text-xs border border-yellow-500/40 rounded bg-background px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-warning/60"
                             />
                           ) : (
                             <button
                               onClick={() => setEditingThreshold({ id: p.id, value: String((p as any).low_stock_threshold ?? 3) })}
                               className="text-xs text-muted-foreground hover:text-yellow-400 transition-colors"
                               title="Click para editar umbral de alerta"
                             >
                               {(p as any).low_stock_threshold ?? 3}
                             </button>
                           )}
                         </td>
                         <td className="p-3 text-right">
                           {(() => {
                             const vel = salesVelocity[p.id] || 0;
                             if (p.stock <= 0) return <span className="text-xs text-muted-foreground">—</span>;
                             if (vel === 0) return <span className="text-xs text-muted-foreground" title="Sin ventas en 60 días">∞</span>;
                             const days = Math.round(p.stock / vel);
                             const color = days <= 7 ? 'text-destructive font-bold' : days <= 21 ? 'text-yellow-400 font-medium' : 'text-emerald-400';
                             return (
                               <span className={`text-xs ${color}`} title={`${(vel * 30).toFixed(1)} uds/mes · stock para ~${plural(days, "día")}`}>
                                 {days}d
                               </span>
                             );
                           })()}
                         </td>
                         <td className="p-3 text-right">
                           {(() => {
                             const last = lastSaleDate[p.id];
                             if (!last) return <span className="text-xs text-muted-foreground" title="Sin ventas registradas en 60 días">+60d</span>;
                             const daysSince = Math.floor((today.getTime() - new Date(last + 'T12:00:00').getTime()) / 86400000);
                             const color = daysSince >= 30 ? 'text-destructive font-bold' : daysSince >= 14 ? 'text-yellow-400' : 'text-muted-foreground';
                             return <span className={`text-xs ${color}`} title={`Última venta: ${last}`}>{daysSince}d</span>;
                           })()}
                         </td>
                         <td className="p-3 text-center">
                           <span className="text-[10px] text-muted-foreground flex items-center justify-center gap-1" title={new Date(p.updated_at).toLocaleString('es-AR')}>
                             <Clock className="w-3 h-3" />
                             {new Date(p.updated_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}
                           </span>
                         </td>
                         <td className="p-3 text-center space-x-1">
                           {canEdit && <Button variant="ghost" size="sm" onClick={() => { setEditing(p); setOpen(true); }}><Pencil className="w-3.5 h-3.5" /></Button>}
                           {canEdit && (
                             <Button
                               variant="ghost"
                               size="sm"
                               title={p.discount_price_ars && Number(p.discount_price_ars) < Number(p.sale_price_ars) ? "Quitar descuento" : "Aplicar descuento rápido"}
                               onClick={() => toggleQuickDiscount(p)}
                             >
                               <Tag className={`w-3.5 h-3.5 ${p.discount_price_ars && Number(p.discount_price_ars) < Number(p.sale_price_ars) ? "text-yellow-400" : "text-muted-foreground"}`} />
                             </Button>
                           )}
                           <Button variant="ghost" size="sm" title="Historial de precios" onClick={() => setPriceHistoryProduct({ id: p.id, name: p.name })}><Clock className="w-3.5 h-3.5 text-muted-foreground" /></Button>
                           {perfumeDetailsByProduct[p.id] && (
                             <Button variant="ghost" size="sm" title="Perfumes similares" onClick={() => setRecoTargetId(p.id)}><Sparkles className="w-3.5 h-3.5 text-primary" /></Button>
                           )}
                           {(canShare || p.barcode) && (
                             <Button
                               variant="ghost"
                               size="sm"
                               title={canShare ? "Compartir producto" : "Copiar código de barras"}
                               onClick={() => {
                                 if (canShare) {
                                   shareProduct({ name: p.name, sale_price_ars: p.sale_price_ars, stock: p.stock });
                                 } else if (p.barcode) {
                                   copyText(p.barcode, "Código de barras");
                                 }
                               }}
                             >
                               {canShare ? <Share2 className="w-3.5 h-3.5 text-muted-foreground" /> : <Copy className="w-3.5 h-3.5 text-muted-foreground" />}
                             </Button>
                           )}
                           <Button
                             variant="ghost"
                             size="sm"
                             title="Calculadora de rentabilidad"
                             onClick={() => { setCalcProduct(p); setCalcOpen(true); }}
                           >
                             <Calculator className="w-3.5 h-3.5 text-muted-foreground" />
                           </Button>
                           {canDelete && (
                             <ConfirmDialog
                               trigger={<Button variant="ghost" size="sm"><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>}
                               title="¿Eliminar producto?"
                               description={`Se eliminará "${p.name}" y no se podrá recuperar.`}
                               confirmText="Eliminar"
                               onConfirm={() => handleDelete(p)}
                             />
                           )}
                         </td>
                       </tr>
                     ))}
                  </tbody>
                </table>
              </div>
               <div className="workspace-products-mobile-list md:hidden space-y-2">
                {items.map((p: any) => (
                  <div key={p.id} className="bg-card border border-border rounded-lg p-3">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {p.image_url && <img src={p.image_url} alt="" className="w-10 h-10 rounded object-cover shrink-0" />}
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{p.name}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] ${colorDeCategoria(p.category)}`}>{nombreCategoria(p.category)}</span>
                            <span className="text-xs text-muted-foreground">{GENDER_ICONS[p.gender]}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        {canEdit && <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setEditing(p); setOpen(true); }}><Pencil className="w-3 h-3" /></Button>}
                        {canEdit && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            title={p.discount_price_ars && Number(p.discount_price_ars) < Number(p.sale_price_ars) ? "Quitar descuento" : "Aplicar descuento rápido"}
                            onClick={() => toggleQuickDiscount(p)}
                          >
                            <Tag className={`w-3 h-3 ${p.discount_price_ars && Number(p.discount_price_ars) < Number(p.sale_price_ars) ? "text-yellow-400" : "text-muted-foreground"}`} />
                          </Button>
                        )}
                        {canDelete && (
                          <ConfirmDialog
                            trigger={<Button variant="ghost" size="sm" className="h-7 w-7 p-0"><Trash2 className="w-3 h-3 text-destructive" /></Button>}
                            title="¿Eliminar producto?"
                            confirmText="Eliminar"
                            onConfirm={() => handleDelete(p)}
                          />
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div><span className="text-muted-foreground block">Costo</span><span>{formatUSD(Number(p.total_cost_usd))}</span></div>
                      <div><span className="text-muted-foreground block">Venta</span><span>{formatARS(Number(p.sale_price_ars))}</span></div>
                      <div><span className="text-muted-foreground block">Ganancia</span>
                        <span className={Number(p.profit_per_unit_ars) > 0 ? 'text-emerald-400' : 'text-destructive'}>{formatARS(Number(p.profit_per_unit_ars))}</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-border">
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-muted-foreground">Stock:</span>
                        {p.stock <= 0 ? <span className="text-xs text-muted-foreground">Sin stock</span> : p.stock <= 3 ? (
                          <span className="text-destructive text-xs font-bold flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{p.stock}</span>
                        ) : <span className="text-emerald-400 text-xs font-medium">{p.stock} uds</span>}
                      </div>
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(p.updated_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <DataPagination
            page={page}
            totalPages={totalPages}
            totalItems={brandKeys.length}
            pageSize={PAGE_SIZE}
            itemLabel="marcas"
            onPageChange={setPage}
          />
        </>
      )}

      </>
      )}

      {/* Profit Calculator Modal */}
      <ProfitCalculatorModal
        open={calcOpen}
        onClose={() => { setCalcOpen(false); setCalcProduct(null); }}
        product={calcProduct || undefined}
        exchangeRate={Number(settings?.exchange_rate) || 1700}
      />

      {/* Barcode print sheet modal */}
      <Dialog open={barcodeOpen} onOpenChange={setBarcodeOpen}>
        <DialogContent className="bg-card border-border sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <Layers className="w-4 h-4 text-primary" />
              Etiquetas de código de barras
            </DialogTitle>
          </DialogHeader>
          <BarcodePrintSheet
            products={filtered.slice(0, 40).map(p => ({
              id: p.id, name: p.name,
              sku: p.sku, barcode: p.barcode,
            }))}
            onClose={() => setBarcodeOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Floating bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="workspace-products-bulk-bar fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-card border border-border rounded-2xl shadow-xl px-4 py-3 animate-in slide-in-from-bottom-4 duration-200">
          <CheckCheck className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">{selectedIds.size} producto{selectedIds.size !== 1 ? 's' : ''} seleccionado{selectedIds.size !== 1 ? 's' : ''}</span>
          <button onClick={() => setSelectedIds(new Set())} className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-lg hover:bg-muted transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
          <div className="w-px h-5 bg-border" />
          <ConfirmDialog
            title={`Eliminar ${selectedIds.size} producto${selectedIds.size !== 1 ? 's' : ''}`}
            description={`¿Eliminar ${selectedIds.size} producto${selectedIds.size !== 1 ? 's' : ''} seleccionado${selectedIds.size !== 1 ? 's' : ''}? Esta acción no se puede deshacer.`}
            onConfirm={handleBulkDelete}
            trigger={
              <button disabled={bulkDeleting} className="flex items-center gap-1.5 text-sm font-medium text-destructive hover:text-destructive/80 px-3 py-1.5 rounded-lg bg-destructive/10 hover:bg-destructive/20 transition-colors disabled:opacity-50">
                <Trash2 className="w-4 h-4" />
                {bulkDeleting ? "Eliminando…" : `Eliminar ${selectedIds.size}`}
              </button>
            }
          />
        </div>
      )}
    </div>
  );
}

// ── Subsección de la ficha de perfume (encabezado + agrupación) ─────────────
function FichaSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2.5 pt-2 mt-1 border-t border-primary/10">
      <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-primary/70">{label}</p>
      {children}
    </div>
  );
}

// ── Chip selector para taxonomías (single o multi) ──────────────────────────
function ChipSelect({ items, selected, onToggle }: { items: TaxItem[]; selected: string[]; onToggle: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map(it => {
        const active = selected.includes(it.value);
        return (
          <button key={it.value} type="button" onClick={() => onToggle(it.value)}
            className={`text-[10px] px-2.5 py-1 rounded-full border font-medium transition-all ${active ? 'bg-primary/20 border-primary text-primary' : 'border-border/60 text-muted-foreground hover:border-primary/40 hover:text-primary'}`}>
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

function ProductForm({ product, settings, userId, orgId, onSave }: { product: any; settings: any; userId: string; orgId?: string; onSave: () => void }) {
  const [name, setName] = useState(product?.name || '');
  const [brand, setBrand] = useState(product?.brand || '');
  const [category, setCategory] = useState(product?.category || '');
  const [gender, setGender] = useState(product?.gender || 'masculino');
  const [costUSD, setCostUSD] = useState(product?.cost_usd?.toString() || '');
  /**
   * ⚠️ En qué moneda se compra este producto.
   *
   * Hasta el 2026-08-26 el costo era **siempre** en dólares y el campo era
   * obligatorio: un comercio que compra en pesos no podía guardar un producto
   * sin inventar una cifra en dólares. Y si la inventaba dividiendo por la
   * cotización, su costo **crecía solo** cada vez que se movía el dólar, sin
   * haber comprado nada.
   *
   * Se deduce de lo que el producto ya tiene, sin adivinar: si hay costo en
   * pesos cargado, es en pesos.
   */
  const [costCurrency, setCostCurrency] = useState<'ARS' | 'USD'>(
    (product?.cost_currency as 'ARS' | 'USD' | null)
      ?? ((product?.cost_ars ?? 0) > 0 ? 'ARS' : 'USD'),
  );
  const [costARS, setCostARS] = useState(product?.cost_ars?.toString() || '');
  const [salePriceARS, setSalePriceARS] = useState(product?.sale_price_ars?.toString() || '');
  const [supplierId, setSupplierId] = useState<string>(product?.supplier_id || '');
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [discountPriceARS, setDiscountPriceARS] = useState(product?.discount_price_ars?.toString() || '');
  // A8 — alicuota propia del producto. Vacio significa "la de la organizacion",
  // que NO es lo mismo que 0: cero es exento, una tasa valida y distinta.
  const [taxRate, setTaxRate] = useState(
    product?.tax_rate === null || product?.tax_rate === undefined ? '' : String(product.tax_rate),
  );
  const [price2xARS, setPrice2xARS] = useState(product?.price_2x_ars?.toString() || '');
  const [stock, setStock] = useState(product?.stock?.toString() || '0');
  const [description, setDescription] = useState(product?.description || '');
  const [featured, setFeatured] = useState(product?.featured || false);
  const [offerExpiresAt, setOfferExpiresAt] = useState(product?.offer_expires_at ? new Date(product.offer_expires_at).toISOString().slice(0, 16) : '');
  // `null` = usa la política de la tienda. Es un tercer estado a propósito: la
  // mayoría de los productos no necesita decidir nada, y forzar true/false en
  // cada uno obligaría a tocarlos todos al cambiar la política.
  const [offerStacks, setOfferStacks] = useState<boolean | null>(
    product?.offer_stacks_payment ?? null,
  );
  const [contentMl, setContentMl] = useState(product?.content_ml?.toString() || '100');
  const [barcode, setBarcode] = useState(product?.barcode || '');
  const [sku, setSku] = useState(product?.sku || '');
  const [lotNumber, setLotNumber] = useState(product?.lot_number || '');
  const [expiryDate, setExpiryDate] = useState(product?.expiry_date || '');
  const [isActive, setIsActive] = useState<boolean>(product?.is_active ?? true);
  const [expectedRestockAt, setExpectedRestockAt] = useState(product?.expected_restock_at || '');
  // Logística — alimenta la cotización de envíos del ecommerce
  const [weightKg, setWeightKg] = useState(product?.weight_kg?.toString() || '');
  const [lengthCm, setLengthCm] = useState(product?.length_cm?.toString() || '');
  const [widthCm, setWidthCm] = useState(product?.width_cm?.toString() || '');
  const [heightCm, setHeightCm] = useState(product?.height_cm?.toString() || '');
  const [tags, setTags] = useState<string[]>(product?.tags || []);
  const [tagInput, setTagInput] = useState('');
  // ── Ficha perfume (solo categorías perfume) ──────────────────────────────
  const [modelo, setModelo] = useState('');
  const [familiaOlfativa, setFamiliaOlfativa] = useState<string>('');
  const [notasSalida, setNotasSalida] = useState<string[]>([]);
  const [notasCorazon, setNotasCorazon] = useState<string[]>([]);
  const [notasFondo, setNotasFondo] = useState<string[]>([]);
  const [duracion, setDuracion] = useState<string>('');
  const [proyeccion, setProyeccion] = useState<string>('');
  const [estacion, setEstacion] = useState<string[]>([]);
  const [ocasion, setOcasion] = useState<string[]>([]);
  const [edadRecomendada, setEdadRecomendada] = useState('');
  const [inspiracion, setInspiracion] = useState('');
  const toggleFrom = (arr: string[], set: (v: string[]) => void, v: string) =>
    set(arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);
  const [generatingDesc, setGeneratingDesc] = useState(false);
  const [manualSalePrice, setManualSalePrice] = useState(!!product);
  const [manualDiscountPrice, setManualDiscountPrice] = useState(!!product);
  // Multi-imagen: mezclar imagenes ya guardadas (urls) y archivos nuevos (File)
  const initialImages: string[] = (product?.image_urls && product.image_urls.length > 0)
    ? product.image_urls
    : (product?.image_url ? [product.image_url] : []);
  const [imageItems, setImageItems] = useState<Array<{ url: string; file?: File }>>(
    initialImages.map((u: string) => ({ url: u }))
  );
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Variants state
  const [variants, setVariants] = useState<any[]>([]);
  const [variantType, setVariantType] = useState(product?.variant_type || 'sabor');
  const [newVariantName, setNewVariantName] = useState('');
  const [newVariantStock, setNewVariantStock] = useState('0');
  const [newVariantPrice, setNewVariantPrice] = useState('');
  const [bulkVariants, setBulkVariants] = useState('');
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [showVariants, setShowVariants] = useState(false);
  const [vaperSubtype, setVaperSubtype] = useState(''); // desechable | pod | liquido | mod
  const [scanBarcodeOpen, setScanBarcodeOpen] = useState(false);
  const [customFieldDefs, setCustomFieldDefs] = useState<any[]>([]);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, any>>(product?.custom_fields ?? {});
  const [productTypes, setProductTypes] = useState<ProductType[]>([]);
  const [productTypeId, setProductTypeId] = useState<string>(product?.product_type_id || '');
  const [attributeDefinitions, setAttributeDefinitions] = useState<AttributeDefinition[]>([]);
  const [attributeValues, setAttributeValues] = useState<Record<string, unknown>>({});
  const [activeLocationCount, setActiveLocationCount] = useState(0);
  /**
   * ¿Esto se descuenta al venderlo?
   *
   * Un servicio —un corte de pelo, una hora de consultoría, un plato— se vende
   * igual que un producto pero no hay nada que descontar. Sin este interruptor
   * el stock baja a −1, −2, −3 en cada venta y el panel dice «agotado» sobre
   * algo que no se agota.
   *
   * La autoridad es `record_stock_movement`, que ignora estos productos; acá
   * sólo se elige. Default `true`: un producto nuevo lleva stock salvo que se
   * diga lo contrario.
   */
  const [manejaStock, setManejaStock] = useState(product?.maneja_stock !== false);

  useEffect(() => {
    if (!orgId) return;
    supabase
      .from("custom_field_defs")
      .select("id, field_key, field_label, field_type, required, options, sort_order")
      .eq("org_id", orgId)
      .eq("entity_type", "product")
      .order("sort_order")
      .then(({ data }) => { if (data) setCustomFieldDefs(data); });
  }, [orgId]);

  useEffect(() => {
    if (!orgId) return;
    listProductTypes(orgId)
      .then(types => {
        setProductTypes(types);
        if (product?.product_type_id && types.some(type => type.id === product.product_type_id)) {
          setProductTypeId(product.product_type_id);
        }
      })
      .catch((error: any) => toast.error(error?.message || 'No se pudieron cargar los tipos de producto'));
  }, [orgId, product?.product_type_id]);

  useEffect(() => {
    if (!orgId || !productTypeId) {
      setAttributeDefinitions([]);
      setAttributeValues({});
      return;
    }
    Promise.all([
      listAttributeDefinitions(orgId, productTypeId),
      product?.id ? listProductAttributeValues(orgId, product.id) : Promise.resolve([]),
    ])
      .then(([definitions, savedValues]) => {
        setAttributeDefinitions(definitions);
        const nextValues: Record<string, unknown> = {};
        (savedValues as any[]).forEach(value => {
          nextValues[value.attribute_definition_id] = value.value_text
            ?? value.value_number
            ?? value.value_boolean
            ?? value.value_date
            ?? value.value_json
            ?? '';
        });
        setAttributeValues(nextValues);
      })
      .catch((error: any) => toast.error(error?.message || 'No se pudieron cargar los atributos'));
  }, [orgId, product?.id, productTypeId]);

  // Con dos depósitos, el stock de una variante no es un número global: hay
  // que ajustarlo desde Sucursales indicando el lugar físico. La base aplica la
  // misma regla, pero esconder el input evita guardar primero la ficha y fallar
  // recién al intentar el Kardex.
  useEffect(() => {
    if (!orgId) return;
    supabase.from("locations").select("id", { count: "exact", head: true })
      .eq("org_id", orgId).eq("active", true)
      .then(({ count }) => setActiveLocationCount(count ?? 0));
  }, [orgId]);

  // Cargar ficha de perfume existente al editar
  useEffect(() => {
    if (!product?.id) return;
    supabase
      .from("product_perfume_details")
      .select("*")
      .eq("product_id", product.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        setModelo(data.modelo || '');
        setFamiliaOlfativa(data.familia_olfativa || '');
        setNotasSalida(data.notas_salida || []);
        setNotasCorazon(data.notas_corazon || []);
        setNotasFondo(data.notas_fondo || []);
        setDuracion(data.duracion || '');
        setProyeccion(data.proyeccion || '');
        setEstacion(data.estacion || []);
        setOcasion(data.ocasion || []);
        setEdadRecomendada(data.edad_recomendada || '');
        setInspiracion(data.inspiracion || '');
      });
  }, [product?.id]);

  // AI product suggestion
  const { suggest: aiSuggest, loading: aiLoading, result: aiResult, clear: aiClear } = useAIProductSuggest(orgId);
  const [aiDismissed, setAiDismissed] = useState(false);

  const isVaper = category === 'vaper';

  // Reset subtype and content_ml defaults when category changes
  useEffect(() => {
    if (!product) {
      setVaperSubtype('');
      if (category === 'vaper') setContentMl('');
      else if (category === 'electronico') setContentMl('');
      else setContentMl('100');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  // AI name suggestion — only for new products, after 3+ characters
  useEffect(() => {
    if (!product && name.length >= 3) {
      setAiDismissed(false);
      aiSuggest(name);
    } else {
      aiClear();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);
  const VARIANT_TYPE_LABELS: Record<string, string> = {
    sabor: 'Sabores', talle: 'Talles', color: 'Colores',
    medida: 'Medidas', otro: 'Variantes',
  };
  const variantLabel = VARIANT_TYPE_LABELS[variantType] || 'Variantes';
  const variantsNeedLocation = activeLocationCount > 1;

  useEffect(() => {
    if (product?.id) {
      getVariantsDB(product.id).then(v => {
        setVariants(v);
        if (v.length > 0) setShowVariants(true);
        if (v[0]?.variant_type) setVariantType(v[0].variant_type);
      });
    }
  }, [product?.id]);

  // Proveedor preferido — lo usan AutoRestock y las órdenes de compra.
  useEffect(() => {
    if (!orgId) return;
    supabase.from('suppliers').select('id,name').eq('org_id', orgId).order('name')
      .then(({ data }) => setSuppliers((data ?? []) as { id: string; name: string }[]), () => {});
  }, [orgId]);

  const cost = parseFloat(costUSD) || 0;
  const costoPesos = parseFloat(costARS) || 0;
  const enPesos = costCurrency === 'ARS';
  const salePrice = parseFloat(salePriceARS) || 0;
  const customsPercent = Number(settings?.customs_percent || 15);
  // `null` = el comercio no cargó cotización. Los cálculos de abajo lo tienen
  // que contemplar en vez de recibir un número inventado.
  const exchangeRate = cotizacionDe(settings) ?? 0;
  const sinCotizacion = faltaCotizacion(settings);
  // Precios por categoría — fuente de verdad compartida en @/lib/pricing
  const categoryMarkup = getCategoryMarkup(settings, category);
  const defaultDiscount = getCategoryDiscount(settings, category);

  const autoSalePrice = calcAutoSalePrice(cost, customsPercent, exchangeRate, categoryMarkup);
  const currentSaleForDiscount = parseFloat(salePriceARS) || autoSalePrice;
  const autoDiscountPrice = calcAutoDiscountPrice(currentSaleForDiscount, defaultDiscount);

  useEffect(() => {
    if (cost <= 0) return;
    if (!manualSalePrice) setSalePriceARS(autoSalePrice.toString());
  }, [cost, customsPercent, exchangeRate, manualSalePrice, autoSalePrice]);

  useEffect(() => {
    if (currentSaleForDiscount <= 0) return;
    if (!manualDiscountPrice) setDiscountPriceARS(autoDiscountPrice.toString());
  }, [currentSaleForDiscount, defaultDiscount, manualDiscountPrice, autoDiscountPrice]);

  const { customsFee, totalCostUSD, totalCostARS, profitPerUnitARS, profitPerUnitUSD } = calculateProductProfits(cost, customsPercent, salePrice, exchangeRate);

  const addFiles = (files: File[]) => {
    const valid: Array<{ url: string; file: File }> = [];
    for (const f of files) {
      if (f.size > 10 * 1024 * 1024) { toast.error(`"${f.name}" supera 10MB`); continue; }
      if (!f.type.startsWith('image/')) continue;
      valid.push({ url: URL.createObjectURL(f), file: f });
    }
    if (valid.length === 0) return;
    setImageItems(prev => [...prev, ...valid].slice(0, 8));
  };
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length === 0) return;
    addFiles(files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };
  const removeImageAt = (idx: number) => {
    setImageItems(prev => prev.filter((_, i) => i !== idx));
  };
  const moveImage = (from: number, to: number) => {
    setImageItems(prev => {
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [it] = next.splice(from, 1);
      next.splice(to, 0, it);
      return next;
    });
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      addFiles(files);
      toast.success(`${files.length} imagen(es) pegada(s)`);
    }
  };

  const uploadAllImages = async (): Promise<string[]> => {
    if (imageItems.length === 0) return [];
    const toUpload = imageItems.filter(it => it.file);
    if (toUpload.length === 0) return imageItems.map(it => it.url);
    setUploading(true);
    try {
      const uploaded: Record<number, string> = {};
      await Promise.all(imageItems.map(async (it, idx) => {
        if (!it.file) { uploaded[idx] = it.url; return; }
        const ext = (it.file.name.split('.').pop() || 'jpg').toLowerCase();
        const path = `${userId}/${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from('product-images').upload(path, it.file, {
          cacheControl: '31536000',
          contentType: it.file.type || `image/${ext}`,
          upsert: false,
        });
        if (error) throw error;
        const { data: urlData } = supabase.storage.from('product-images').getPublicUrl(path);
        uploaded[idx] = urlData.publicUrl;
      }));
      return imageItems.map((_, i) => uploaded[i]);
    } catch (err: any) {
      toast.error('Error subiendo imagen: ' + err.message);
      return imageItems.map(it => it.url);
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { toast.error("El nombre es obligatorio"); return; }
    if (cost <= 0) { toast.error("El costo debe ser mayor a 0"); return; }
    const missingAttribute = attributeDefinitions.find(definition => {
      if (!definition.required) return false;
      const value = attributeValues[definition.id];
      return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
    });
    if (missingAttribute) {
      toast.error(`Completá el atributo obligatorio: ${missingAttribute.name}`);
      return;
    }
    try {
      if (variantsNeedLocation && showVariants) {
        const existingForLocation = product?.id ? await getVariantsDB(product.id) : [];
        const currentIds = new Set(variants.filter(v => v.id).map(v => v.id));
        const removedWithStock = existingForLocation.find(v => !currentIds.has(v.id) && Number(v.stock) > 0);
        if (removedWithStock || variants.some(v => !v.id && Number(v.stock) > 0)) {
          toast.error("Con más de un depósito, ajustá o transferí el stock de cada variante desde Sucursales antes de eliminarla o cargarla.");
          return;
        }
      }
      const urls = await uploadAllImages();
      const imageUrl = urls[0] || null;
      const variantTotal = showVariants && variants.length > 0
        ? variants.reduce((s, v) => s + (v.stock || 0), 0)
        : parseInt(stock) || 0;
      const data = {
        name: name.trim().toUpperCase(), brand: brand.trim().toUpperCase(), category: category || null, gender, description: description.trim() || null,
        // ⚠️ La moneda va explícita: sin ella el resolver tiene que deducirla, y
        // deducir la moneda de un costo es deducir el margen.
        cost_usd: enPesos ? 0 : cost,
        cost_ars: enPesos ? costoPesos : null,
        cost_currency: costCurrency,
        customs_fee: enPesos ? 0 : customsFee,
        total_cost_usd: enPesos ? 0 : totalCostUSD,
        sale_price_ars: salePrice, discount_price_ars: parseFloat(discountPriceARS) || null,
        // Se distingue el vacio del cero a proposito: `parseFloat('') || null`
        // convertiria un 0 legitimo en null y el exento pasaria a gravado.
        tax_rate: taxRate.trim() === '' ? null : Number(taxRate),
        price_2x_ars: isVaper ? (parseFloat(price2xARS) || null) : null,
        profit_per_unit_ars: profitPerUnitARS, profit_per_unit_usd: profitPerUnitUSD,
        image_url: imageUrl,
        image_urls: urls,
        featured,
        offer_expires_at: offerExpiresAt ? new Date(offerExpiresAt).toISOString() : null,
        offer_stacks_payment: offerStacks,
        content_ml: parseInt(contentMl) || 100,
        // Campos que el form captura pero antes NO se persistían
        barcode: barcode.trim() || null,
        sku: sku.trim() || null,
        lot_number: lotNumber.trim() || null,
        expiry_date: expiryDate || null,
        tags,
        is_active: isActive,
        expected_restock_at: expectedRestockAt || null,
        supplier_id: supplierId || null,
        // Peso y dimensiones: los usa el cotizador de envíos de la tienda online.
        // Vacío = la tienda cotiza con su peso estimado por default.
        weight_kg: parseFloat(weightKg) || null,
        length_cm: parseFloat(lengthCm) || null,
        width_cm: parseFloat(widthCm) || null,
        height_cm: parseFloat(heightCm) || null,
        product_type_id: productTypeId || null,
        maneja_stock: manejaStock,
        ...(Object.keys(customFieldValues).length > 0 ? { custom_fields: customFieldValues } : {}),
      };
      let productId = product?.id;
      if (product) {
        await updateProductDB(product.id, data);
        // ⚠️ Sobre un producto sin stock no se fuerza ningún ajuste. La
        // autoridad lo ignoraría igual, pero pedirle un movimiento que no va a
        // ocurrir deja un «Ajuste de stock» en el log de auditoría que nunca
        // pasó.
        if (!showVariants && manejaStock) {
          await setStockAbsoluteDB({
            productId: product.id,
            newStock: variantTotal,
            userId,
            orgId,
            notes: "Ajuste de stock al editar producto",
          });
        }
        await logAudit(userId, 'update', 'product', product.id, { name: data.name, changes: data });
      } else {
        productId = crypto.randomUUID();
        await addProductDB({
          ...data,
          user_id: userId,
          id: productId,
          // Cuando hay variantes, los ajustes de cada variante derivan el total
          // del producto. Cargar el total primero dejaría dos caminos de stock.
          stock: showVariants ? 0 : variantTotal,
        });
        await logAudit(userId, 'create', 'product', productId, { name: data.name });
      }
      if (productId && orgId) {
        await saveProductAttributeValues(orgId, productId, attributeDefinitions, attributeValues);
      }
      // Ficha de perfume — solo para categorías perfume
      if (productId && (category === 'perfume_arabe' || category === 'perfume_diseñador') && orgId) {
        const { error: ppdErr } = await supabase.from('product_perfume_details').upsert({
          product_id: productId,
          org_id: orgId,
          modelo: modelo.trim() || null,
          familia_olfativa: familiaOlfativa || null,
          notas_salida: notasSalida,
          notas_corazon: notasCorazon,
          notas_fondo: notasFondo,
          duracion: duracion || null,
          proyeccion: proyeccion || null,
          estacion,
          ocasion,
          edad_recomendada: edadRecomendada.trim() || null,
          inspiracion: inspiracion.trim() || null,
        }, { onConflict: 'product_id' });
        if (ppdErr) console.error('Error guardando ficha de perfume:', ppdErr);
      }
      if (showVariants && productId) {
        const existingVariants = product?.id ? await getVariantsDB(product.id) : [];
        const existingIds = new Set(existingVariants.map((v: any) => v.id));
        const currentIds = new Set(variants.filter(v => v.id).map(v => v.id));
        for (const ev of existingVariants) {
          if (!currentIds.has(ev.id)) {
            if (!variantsNeedLocation) {
              await setStockAbsoluteDB({
                productId,
                variantId: ev.id,
                newStock: 0,
                userId,
                orgId,
                notes: "Stock retirado al eliminar variante",
              });
            }
            await deleteVariantDB(ev.id);
          }
        }
        for (const v of variants) {
          if (v.id && existingIds.has(v.id)) {
            await updateVariantDB(v.id, { variant_name: v.variant_name, active: v.active !== false, price_override: v.price_override ?? null });
            if (!variantsNeedLocation) {
              await setStockAbsoluteDB({
                productId,
                variantId: v.id,
                newStock: Number(v.stock),
                userId,
                orgId,
                notes: "Ajuste de stock al editar variante",
              });
            }
          } else if (v._new || !v.id) {
            await addVariantDB({ product_id: productId, user_id: userId, variant_name: v.variant_name, stock: v.stock, active: true, variant_type: variantType, price_override: v.price_override ?? null });
          }
        }
        if (variants.length === 0) {
          await setStockAbsoluteDB({
            productId,
            newStock: 0,
            userId,
            orgId,
            notes: "Producto sin variantes",
          });
        }
      }
      toast.success(product ? "Producto actualizado" : "Producto agregado");
      broadcastSync({ type: "product_saved", name: data.name, action: product ? "update" : "create" });
      onSave();
    } catch (err: any) {
      console.error('Error guardando producto:', err);
      toast.error(err?.message || "Error al guardar el producto");
    }
  };

  return (
    <form onSubmit={handleSubmit} onPaste={handlePaste} className="space-y-4 pb-12">
      {/* Image upload (multi) */}
      <div>
        <div className="flex items-center justify-between">
          <label className="text-sm text-muted-foreground">Imágenes del producto (HD, máx 8)</label>
          <span className="text-[10px] text-muted-foreground/60">La primera es la principal · arrastrá con ◀ ▶</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {imageItems.map((it, idx) => (
            <div key={idx} className="relative group">
              <img
                src={it.url}
                alt=""
                loading="lazy"
                decoding="async"
                className="w-20 h-20 rounded-lg object-cover border border-border"
              />
              {idx === 0 && (
                <span className="absolute -top-1.5 -left-1.5 px-1.5 rounded bg-primary text-[9px] font-bold text-primary-foreground">PPAL</span>
              )}
              <button type="button" onClick={() => removeImageAt(idx)} className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full w-5 h-5 flex items-center justify-center">
                <X className="w-3 h-3" />
              </button>
              <div className="absolute bottom-0 inset-x-0 flex justify-between px-1 opacity-0 group-hover:opacity-100 transition">
                <button type="button" onClick={() => moveImage(idx, idx - 1)} className="text-[10px] bg-black/60 text-white rounded px-1">◀</button>
                <button type="button" onClick={() => moveImage(idx, idx + 1)} className="text-[10px] bg-black/60 text-white rounded px-1">▶</button>
              </div>
            </div>
          ))}
          {imageItems.length < 8 && (
            <button type="button" onClick={() => fileInputRef.current?.click()} className="w-20 h-20 rounded-lg border-2 border-dashed border-border flex flex-col items-center justify-center text-muted-foreground hover:border-primary hover:text-primary transition-colors">
              <Upload className="w-5 h-5" />
              <span className="text-[10px] mt-0.5">Agregar</span>
            </button>
          )}
          <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleImageSelect} className="hidden" />
        </div>
        <p className="text-[10px] text-muted-foreground/60 mt-1">Pegá imágenes con Ctrl+V · se mantienen en calidad original (sin recompresión).</p>
      </div>
      {/* Name + barcode scan */}
      <div>
        <label className="text-sm text-muted-foreground">Nombre *</label>
        <div className="flex gap-2">
          <Input
            value={name}
            onChange={e => setName(e.target.value.toUpperCase())}
            placeholder="Ej: LATTAFA KHAMRAH 100ML"
            className="bg-muted border-border uppercase flex-1"
            required
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="shrink-0 border-border"
            title="Escanear código de barras"
            onClick={() => setScanBarcodeOpen(true)}
          >
            <ScanLine className="w-4 h-4" />
          </Button>
        </div>
        {/* AI suggestion banner */}
        {!product && !aiDismissed && aiResult && (
          <div className="mt-2 p-2.5 rounded-lg bg-primary/8 border border-primary/25 flex items-start gap-2 animate-in slide-in-from-top-1 duration-200">
            <Brain className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold text-primary mb-1">Sugerencia IA</p>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                {aiResult.category && <span>📁 {aiResult.category}</span>}
                {aiResult.priceMin && aiResult.priceMax && (
                  <span>💰 ${aiResult.priceMin.toLocaleString("es-AR")} – ${aiResult.priceMax.toLocaleString("es-AR")}</span>
                )}
                {aiResult.brand && <span>🏷 {aiResult.brand}</span>}
                {aiResult.description && <span className="truncate max-w-full">{aiResult.description}</span>}
              </div>
            </div>
            <div className="flex gap-1 shrink-0">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-6 text-[10px] px-2 text-primary hover:bg-primary/10"
                onClick={() => {
                  if (aiResult.category) setCategory(aiResult.category);
                  if (aiResult.description && !description) setDescription(aiResult.description);
                  if (aiResult.brand && !brand) setBrand(aiResult.brand.toUpperCase());
                  if (aiResult.priceMax && !salePriceARS) setSalePriceARS(aiResult.priceMax.toString());
                  setAiDismissed(true);
                  toast.success("Sugerencia IA aplicada", { duration: 2000 });
                }}
              >
                <Check className="w-3 h-3 mr-1" /> Aplicar
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-6 text-[10px] px-2 text-muted-foreground/60 hover:text-muted-foreground"
                onClick={() => setAiDismissed(true)}
              >
                <X className="w-3 h-3" />
              </Button>
            </div>
          </div>
        )}
        {!product && !aiDismissed && aiLoading && name.length >= 3 && (
          <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
            <Brain className="w-3 h-3 animate-pulse text-primary/60" />
            <span>IA analizando producto...</span>
          </div>
        )}
      </div>

      {/* Barcode scan modal */}
      <BarcodeScanModal
        open={scanBarcodeOpen}
        onClose={() => setScanBarcodeOpen(false)}
        onDetect={(code) => { setBarcode(code); setScanBarcodeOpen(false); }}
        title="Escanear código de barras del producto"
      />
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-sm text-muted-foreground">Marca</label><Input value={brand} onChange={e => setBrand(e.target.value.toUpperCase())} className="bg-muted border-border uppercase" /></div>
        <div><label className="text-sm text-muted-foreground">Categoría</label>
          {/* Sale de `ecommerce_categories`, y deja crear una desde acá. Con las
              cuatro escritas a mano, el comercio podía crear "Ropa de verano"
              en la tienda y no podía asignársela a ningún producto. */}
          <CategorySelect
            value={category}
            onChange={setCategory}
            orgId={orgId}
            className="bg-muted border-border"
          />
        </div>
      </div>
      <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Tipo de producto</p>
            <p className="text-[11px] text-muted-foreground">Define los atributos propios del rubro. Es opcional para fichas existentes.</p>
          </div>
          <Layers className="w-4 h-4 text-primary shrink-0" />
        </div>
        <Select value={productTypeId || "none"} onValueChange={value => {
          const id = value === "none" ? "" : value;
          setProductTypeId(id);
          // El tipo trae el default: un «Servicio» no se stockea, un «Insumo»
          // sí. Sólo al crear — en un producto que ya existe, cambiar el tipo
          // no puede reescribir una decisión que el comercio ya tomó.
          if (!product && id) {
            const tipo = productTypes.find(t => t.id === id);
            if (tipo) setManejaStock(tipo.maneja_stock !== false);
          }
        }}>
          <SelectTrigger className="bg-background border-border"><SelectValue placeholder="Sin tipo asignado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Sin tipo asignado</SelectItem>
            {productTypes.map(type => <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {productTypes.length === 0 && <p className="text-[11px] text-muted-foreground">Configurá el primer tipo desde “Tipos y atributos” en la barra de Productos.</p>}
      </div>
      {/* ── Smart suggestions panel ── */}
      {category === 'vaper' && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2.5">
          <p className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5" />Creación inteligente — Vaper
          </p>
          {/* Subtype */}
          <div>
            <p className="text-[10px] text-muted-foreground mb-1.5">Tipo de producto</p>
            <div className="flex flex-wrap gap-1.5">
              {(['Desechable', 'Pod / Cartucho', 'Líquido', 'Mod Box'] as const).map(t => {
                const key = t === 'Desechable' ? 'desechable' : t === 'Pod / Cartucho' ? 'pod' : t === 'Líquido' ? 'liquido' : 'mod';
                return (
                  <button key={t} type="button"
                    className={`text-[10px] px-2.5 py-1 rounded-full border font-medium transition-all ${vaperSubtype === key ? 'bg-emerald-500/30 border-emerald-500 text-emerald-400' : 'border-border/60 text-muted-foreground hover:border-emerald-500/40 hover:text-emerald-400'}`}
                    onClick={() => {
                      setVaperSubtype(key);
                      if (key === 'desechable') { setContentMl(''); setVariantType('sabor'); }
                      else if (key === 'pod') { setContentMl('2'); setVariantType('sabor'); }
                      else if (key === 'liquido') { setContentMl('30'); setVariantType('sabor'); }
                      else { setContentMl(''); setVariantType('otro'); }
                    }}
                  >{t}</button>
                );
              })}
            </div>
          </div>

          {/* Desechable: puffs + nic */}
          {vaperSubtype === 'desechable' && (
            <>
              <div>
                <p className="text-[10px] text-muted-foreground mb-1.5">Puffs</p>
                <div className="flex flex-wrap gap-1.5">
                  {[600, 1000, 1500, 2000, 4000, 5000, 6000, 10000].map(p => (
                    <button key={p} type="button"
                      className="text-[10px] px-2.5 py-1 rounded-full border border-border/60 text-muted-foreground hover:border-emerald-500/40 hover:text-emerald-400 transition-all"
                      onClick={() => {
                        const suffix = `${p} PUFFS`;
                        setName(prev => {
                          const base = prev.replace(/\d+ PUFFS/g, '').trim();
                          return base ? `${base} ${suffix}` : suffix;
                        });
                      }}
                    >{p.toLocaleString()} puffs</button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground mb-1.5">Nicotina</p>
                <div className="flex flex-wrap gap-1.5">
                  {['Sin nicotina', '20mg Salt', '50mg Salt', '3mg', '6mg'].map(nic => (
                    <button key={nic} type="button"
                      className="text-[10px] px-2.5 py-1 rounded-full border border-border/60 text-muted-foreground hover:border-emerald-500/40 hover:text-emerald-400 transition-all"
                      onClick={() => setDescription(prev => prev ? `${prev} · ${nic}` : nic)}
                    >{nic}</button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Pod: capacidad */}
          {vaperSubtype === 'pod' && (
            <div>
              <p className="text-[10px] text-muted-foreground mb-1.5">Capacidad del cartucho</p>
              <div className="flex flex-wrap gap-1.5">
                {['1.8', '2', '2.5', '3', '5', '8', '10'].map(ml => (
                  <button key={ml} type="button"
                    className="text-[10px] px-2.5 py-1 rounded-full border border-border/60 text-muted-foreground hover:border-emerald-500/40 hover:text-emerald-400 transition-all"
                    onClick={() => setContentMl(ml)}
                  >{ml}ml</button>
                ))}
              </div>
            </div>
          )}

          {/* Líquido: volumen + nic */}
          {vaperSubtype === 'liquido' && (
            <>
              <div>
                <p className="text-[10px] text-muted-foreground mb-1.5">Volumen</p>
                <div className="flex flex-wrap gap-1.5">
                  {['10', '30', '60', '100', '120'].map(ml => (
                    <button key={ml} type="button"
                      className={`text-[10px] px-2.5 py-1 rounded-full border font-medium transition-all ${contentMl === ml ? 'bg-emerald-500/30 border-emerald-500 text-emerald-400' : 'border-border/60 text-muted-foreground hover:border-emerald-500/40 hover:text-emerald-400'}`}
                      onClick={() => {
                        setContentMl(ml);
                        setName(prev => {
                          const base = prev.replace(/\d+ML/g, '').trim();
                          return base ? `${base} ${ml}ML` : `${ml}ML`;
                        });
                      }}
                    >{ml}ml</button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground mb-1.5">Nicotina</p>
                <div className="flex flex-wrap gap-1.5">
                  {['0mg', '3mg', '6mg', '12mg', '18mg', '20mg Sal', '25mg Sal', '50mg Sal'].map(nic => (
                    <button key={nic} type="button"
                      className="text-[10px] px-2.5 py-1 rounded-full border border-border/60 text-muted-foreground hover:border-emerald-500/40 hover:text-emerald-400 transition-all"
                      onClick={() => setDescription(prev => prev ? `${prev} · ${nic}` : nic)}
                    >{nic}</button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Mod Box: wattage */}
          {vaperSubtype === 'mod' && (
            <div>
              <p className="text-[10px] text-muted-foreground mb-1.5">Potencia máxima</p>
              <div className="flex flex-wrap gap-1.5">
                {['40W', '60W', '80W', '100W', '160W', '220W'].map(w => (
                  <button key={w} type="button"
                    className="text-[10px] px-2.5 py-1 rounded-full border border-border/60 text-muted-foreground hover:border-emerald-500/40 hover:text-emerald-400 transition-all"
                    onClick={() => setName(prev => prev ? `${prev} ${w}` : w)}
                  >{w}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {(category === 'perfume_arabe' || category === 'perfume_diseñador') && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 space-y-2.5">
          <p className="text-xs font-semibold text-primary flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5" />Creación inteligente — Perfume
          </p>
          <div>
            <p className="text-[10px] text-muted-foreground mb-1.5">Contenido</p>
            <div className="flex flex-wrap gap-1.5">
              {(category === 'perfume_arabe'
                ? ['25', '50', '80', '100']
                : ['30', '50', '100', '150', '200']
              ).map(ml => (
                <button key={ml} type="button"
                  className={`text-[10px] px-2.5 py-1 rounded-full border font-medium transition-all ${contentMl === ml ? 'bg-primary/20 border-primary text-primary' : 'border-border/60 text-muted-foreground hover:border-primary/40 hover:text-primary'}`}
                  onClick={() => {
                    setContentMl(ml);
                    setName(prev => {
                      const base = prev.replace(/\d+ML/g, '').trim();
                      return base ? `${base} ${ml}ML` : `${ml}ML`;
                    });
                  }}
                >{ml}ml</button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground mb-1.5">Género</p>
            <div className="flex gap-1.5">
              {(['masculino', 'femenino', 'unisex'] as const).map(g => (
                <button key={g} type="button"
                  className={`text-[10px] px-2.5 py-1 rounded-full border font-medium transition-all capitalize ${gender === g ? 'bg-primary/20 border-primary text-primary' : 'border-border/60 text-muted-foreground hover:border-primary/40 hover:text-primary'}`}
                  onClick={() => setGender(g)}
                >{g}</button>
              ))}
            </div>
          </div>

          {/* ── Ficha olfativa premium ─────────────────────────────── */}
          {/* Identidad */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <div>
              <p className="text-[10px] text-muted-foreground mb-1">Modelo</p>
              <Input value={modelo} onChange={e => setModelo(e.target.value)} placeholder="Ej: Khamrah" className="bg-muted border-border h-8 text-xs" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground mb-1">Inspiración (clon de)</p>
              <Input value={inspiracion} onChange={e => setInspiracion(e.target.value)} placeholder="Ej: Angels' Share" className="bg-muted border-border h-8 text-xs" />
            </div>
          </div>

          {/* Perfil olfativo */}
          <FichaSection label="Perfil olfativo">
            <div>
              <p className="text-[10px] text-muted-foreground mb-1.5">Familia</p>
              <ChipSelect items={FAMILIAS_OLFATIVAS} selected={familiaOlfativa ? [familiaOlfativa] : []} onToggle={v => setFamiliaOlfativa(familiaOlfativa === v ? '' : v)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] text-muted-foreground mb-1.5">Duración</p>
                <ChipSelect items={DURACIONES} selected={duracion ? [duracion] : []} onToggle={v => setDuracion(duracion === v ? '' : v)} />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground mb-1.5">Proyección</p>
                <ChipSelect items={PROYECCIONES} selected={proyeccion ? [proyeccion] : []} onToggle={v => setProyeccion(proyeccion === v ? '' : v)} />
              </div>
            </div>
          </FichaSection>

          {/* Pirámide de notas */}
          <FichaSection label="Pirámide de notas">
            <div>
              <p className="text-[10px] text-muted-foreground mb-1.5">Salida</p>
              <ChipSelect items={NOTAS_COMUNES} selected={notasSalida} onToggle={v => toggleFrom(notasSalida, setNotasSalida, v)} />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground mb-1.5">Corazón</p>
              <ChipSelect items={NOTAS_COMUNES} selected={notasCorazon} onToggle={v => toggleFrom(notasCorazon, setNotasCorazon, v)} />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground mb-1.5">Fondo</p>
              <ChipSelect items={NOTAS_COMUNES} selected={notasFondo} onToggle={v => toggleFrom(notasFondo, setNotasFondo, v)} />
            </div>
          </FichaSection>

          {/* Uso ideal */}
          <FichaSection label="Uso ideal">
            <div>
              <p className="text-[10px] text-muted-foreground mb-1.5">Estación</p>
              <ChipSelect items={ESTACIONES} selected={estacion} onToggle={v => toggleFrom(estacion, setEstacion, v)} />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground mb-1.5">Ocasión</p>
              <ChipSelect items={OCASIONES} selected={ocasion} onToggle={v => toggleFrom(ocasion, setOcasion, v)} />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground mb-1">Edad recomendada</p>
              <Input value={edadRecomendada} onChange={e => setEdadRecomendada(e.target.value)} placeholder="Ej: 25-40 · todas las edades" className="bg-muted border-border h-8 text-xs" />
            </div>
          </FichaSection>
        </div>
      )}

      {category === 'electronico' && (
        <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-3 space-y-2.5">
          <p className="text-xs font-semibold text-yellow-400 flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5" />Creación inteligente — Electrónico
          </p>
          <div>
            <p className="text-[10px] text-muted-foreground mb-1.5">Tipo de producto</p>
            <div className="flex flex-wrap gap-1.5">
              {['Auricular', 'Cargador', 'Cable', 'Smartwatch', 'Powerbank', 'Teclado', 'Mouse', 'Parlante', 'Cámara'].map(t => (
                <button key={t} type="button"
                  className="text-[10px] px-2.5 py-1 rounded-full border border-border/60 text-muted-foreground hover:border-yellow-500/40 hover:text-yellow-400 transition-all"
                  onClick={() => {
                    setName(prev => prev ? prev : t.toUpperCase());
                    setVariantType('color');
                  }}
                >{t}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-sm text-muted-foreground">Género</label>
          <Select value={gender} onValueChange={setGender}><SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="masculino">Masculino</SelectItem><SelectItem value="femenino">Femenino</SelectItem><SelectItem value="unisex">Unisex</SelectItem></SelectContent>
          </Select>
        </div>
        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <label className="text-sm text-muted-foreground">Stock</label>
            {/* Un servicio no se descuenta: el interruptor va PEGADO al campo
                que deja de tener sentido, no escondido en otra pestaña. */}
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
              <Switch checked={!manejaStock} onCheckedChange={v => setManejaStock(!v)} />
              No lleva stock
            </label>
          </div>
          {manejaStock ? (
            <Input type="number" min="0" value={stock} onChange={e => setStock(e.target.value)} className="bg-muted border-border" />
          ) : (
            <p className="text-[11px] text-muted-foreground rounded-[8px] border border-border/60 bg-muted/40 p-2">
              Se vende y se factura, pero no se descuenta nada. Para un servicio,
              una hora de trabajo o un plato.
            </p>
          )}
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-sm text-muted-foreground">
            Costo {enPesos ? 'en pesos' : 'USD'} *
          </label>
          {/* El comercio que compra en pesos no pasa por el dólar. */}
          <div className="flex rounded-md border border-border overflow-hidden text-[10px]">
            <button
              type="button"
              onClick={() => { setCostCurrency('ARS'); setManualSalePrice(false); setManualDiscountPrice(false); }}
              className={`px-2 py-0.5 transition-colors ${enPesos ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
            >Pesos</button>
            <button
              type="button"
              onClick={() => { setCostCurrency('USD'); setManualSalePrice(false); setManualDiscountPrice(false); }}
              className={`px-2 py-0.5 transition-colors ${!enPesos ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
            >USD</button>
          </div>
        </div>

        {enPesos ? (
          <>
            <Input
              type="number" step="0.01" min="0" value={costARS}
              onChange={e => { setCostARS(e.target.value); setManualSalePrice(false); setManualDiscountPrice(false); }}
              className="bg-muted border-border" required
            />
            {costoPesos > 0 && (
              <p className="text-[10px] text-muted-foreground mt-1">
                Sin tipo de cambio ni aduana: el costo es {formatARS(costoPesos)} y no cambia
                porque se mueva el dólar. Precio con {categoryMarkup}× ={' '}
                {formatARS(costoPesos * categoryMarkup)}
              </p>
            )}
          </>
        ) : (
          <>
            <Input type="number" step="0.01" min="0" value={costUSD} onChange={e => { setCostUSD(e.target.value); setManualSalePrice(false); setManualDiscountPrice(false); }} className="bg-muted border-border" required />
            {cost > 0 && (
              <p className="text-[10px] text-muted-foreground mt-1">
                Fórmula: [(${cost}+{customsPercent}%) × ${exchangeRate}] × {categoryMarkup} = {formatARS(autoSalePrice)} · -{defaultDiscount}% = {formatARS(autoDiscountPrice)}
              </p>
            )}
          </>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="flex items-center justify-between">
            <label className="text-sm text-muted-foreground">Precio Venta ARS</label>
            {manualSalePrice && cost > 0 && (
              <button type="button" onClick={() => setManualSalePrice(false)} className="text-[10px] text-primary hover:underline">Auto</button>
            )}
          </div>
          <Input type="number" min="0" value={salePriceARS} onChange={e => { setSalePriceARS(e.target.value); setManualSalePrice(true); }} className="bg-muted border-border" />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <label className="text-sm text-muted-foreground">Precio c/Desc. ARS</label>
            {manualDiscountPrice && currentSaleForDiscount > 0 && (
              <button type="button" onClick={() => setManualDiscountPrice(false)} className="text-[10px] text-primary hover:underline">Auto</button>
            )}
          </div>
          <Input type="number" min="0" value={discountPriceARS} onChange={e => { setDiscountPriceARS(e.target.value); setManualDiscountPrice(true); }} placeholder="Auto-calculado" className="bg-muted border-border" />
        </div>

        {/* A8 — la orden discriminaba IVA con una tasa unica para todo. Un
            catalogo con 21% y 10,5% mezclados facturaba mal en silencio. */}
        <div>
          <label className="text-sm text-muted-foreground">Alícuota de IVA</label>
          <Input
            type="number" min="0" max="100" step="0.5" value={taxRate}
            onChange={e => setTaxRate(e.target.value)}
            placeholder="La de la organización"
            className="bg-muted border-border"
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            {taxRate.trim() === ''
              ? 'Vacío usa la tasa configurada en Impuestos.'
              : Number(taxRate) === 0
                ? 'Exento: no se le calcula IVA.'
                : `Se factura al ${taxRate}%.`}
          </p>
        </div>
      </div>

      {/* Precios por lista (mayorista / distribuidor) */}
      <ProductPriceListsSection productId={product?.id} orgId={orgId} salePriceARS={salePrice} />

      {suppliers.length > 0 && (
        <div>
          <label className="text-sm text-muted-foreground">Proveedor</label>
          <Select value={supplierId || 'none'} onValueChange={v => setSupplierId(v === 'none' ? '' : v)}>
            <SelectTrigger className="bg-muted border-border">
              <SelectValue placeholder="Sin proveedor" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Sin proveedor</SelectItem>
              {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-[10px] text-muted-foreground mt-1">
            Agrupa las sugerencias de reposición y arma las órdenes de compra por proveedor.
          </p>
        </div>
      )}
      {/* ── AI Price Intelligence ─────────────────────────────── */}
      {cost > 0 && (
        <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold flex items-center gap-1.5 text-blue-400">
              <Sparkles className="w-3.5 h-3.5" />Inteligencia de Precios
            </p>
            {salePrice > 0 && (() => {
              const margin = ((salePrice - totalCostARS) / salePrice) * 100;
              const clr = margin >= 50 ? "text-emerald-400" : margin >= 35 ? "text-blue-400" : margin >= 20 ? "text-yellow-400" : "text-red-400";
              return <span className={`text-[11px] font-bold ${clr}`}>Margen actual: {margin.toFixed(1)}%</span>;
            })()}
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {([30, 40, 50, 60] as const).map(targetMargin => {
              const suggested = Math.round(totalCostARS / (1 - targetMargin / 100));
              const currentMargin = salePrice > 0 ? ((salePrice - totalCostARS) / salePrice) * 100 : -1;
              const active = salePrice > 0 && Math.abs(currentMargin - targetMargin) < 2;
              return (
                <button
                  key={targetMargin}
                  type="button"
                  onClick={() => { setSalePriceARS(suggested.toString()); setManualSalePrice(true); }}
                  className={`text-center rounded-lg border py-1.5 px-1 transition-all hover:scale-105 ${
                    active
                      ? "border-blue-500/60 bg-blue-500/20 text-blue-300"
                      : "border-border/50 hover:border-blue-500/40 text-muted-foreground hover:text-blue-300"
                  }`}
                >
                  <p className="text-[9px] font-medium">{targetMargin}%</p>
                  <p className="text-[10px] font-bold">{formatARS(suggested)}</p>
                </button>
              );
            })}
          </div>
          {salePrice > 0 && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="text-[10px] text-muted-foreground hover:text-foreground px-2 py-0.5 rounded border border-border/40 hover:border-border/70 transition-colors"
                onClick={() => { setSalePriceARS(String(Math.ceil(salePrice / 100) * 100)); setManualSalePrice(true); }}
              >
                Redondear ↑ {formatARS(Math.ceil(salePrice / 100) * 100)}
              </button>
              <button
                type="button"
                className="text-[10px] text-muted-foreground hover:text-foreground px-2 py-0.5 rounded border border-border/40 hover:border-border/70 transition-colors"
                onClick={() => { setSalePriceARS(String(Math.ceil(salePrice / 500) * 500)); setManualSalePrice(true); }}
              >
                Múltiplo 500 → {formatARS(Math.ceil(salePrice / 500) * 500)}
              </button>
            </div>
          )}
        </div>
      )}

      {isVaper && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
          <label className="text-sm font-medium text-emerald-400 flex items-center gap-1.5 mb-1.5">
            <DollarSign className="w-3.5 h-3.5" /> Precio pack 2X (marketing)
          </label>
          <Input
            type="number"
            min="0"
            value={price2xARS}
            onChange={e => setPrice2xARS(e.target.value)}
            placeholder={`Ej: ${Math.round((parseFloat(discountPriceARS) || parseFloat(salePriceARS) || 0) * 1.9).toLocaleString('es-AR')}`}
            className="bg-muted border-border"
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            Se muestra como "2X $XX.XXX" en el catálogo PDF · dejá vacío para calcular automático (precio × 2)
          </p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm text-muted-foreground">Descripción</label>
          <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Notas sobre el producto" className="bg-muted border-border" />
        </div>
        {category !== 'electronico' && !(category === 'vaper' && vaperSubtype === 'desechable') && (
          <div>
            <label className="text-sm text-muted-foreground">
              {category === 'vaper' ? 'Capacidad (ml)' : 'Contenido (ml)'}
            </label>
            <Input type="number" min="0.1" step="0.1" value={contentMl} onChange={e => setContentMl(e.target.value)} className="bg-muted border-border"
              placeholder={category === 'vaper' ? 'Ej: 2, 5, 10...' : 'Ej: 100'} />
          </div>
        )}
      </div>
      {/* Barcode & SKU */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm text-muted-foreground">Código de barras</label>
          <Input value={barcode} onChange={e => setBarcode(e.target.value)} placeholder="EAN-13, UPC..." className="bg-muted border-border font-mono text-sm" />
        </div>
        <div>
          <label className="text-sm text-muted-foreground">SKU interno</label>
          <Input value={sku} onChange={e => setSku(e.target.value)} placeholder="Ej: LAT-KHA-100" className="bg-muted border-border font-mono text-sm" />
        </div>
      </div>
      {/* Logística — peso y dimensiones para cotizar envíos */}
      <div>
        <label className="text-sm text-muted-foreground">Peso y dimensiones</label>
        <p className="text-[11px] text-muted-foreground/70 mb-1.5">
          Los usa tu tienda online para cotizar el envío. Si los dejás vacíos, se cotiza
          con el peso estimado que configuraste en la tienda.
        </p>
        <div className="grid grid-cols-4 gap-2">
          <Input type="number" min="0" step="0.01" value={weightKg} onChange={e => setWeightKg(e.target.value)}
            placeholder="Peso kg" className="bg-muted border-border text-sm" />
          <Input type="number" min="0" step="0.5" value={lengthCm} onChange={e => setLengthCm(e.target.value)}
            placeholder="Largo cm" className="bg-muted border-border text-sm" />
          <Input type="number" min="0" step="0.5" value={widthCm} onChange={e => setWidthCm(e.target.value)}
            placeholder="Ancho cm" className="bg-muted border-border text-sm" />
          <Input type="number" min="0" step="0.5" value={heightCm} onChange={e => setHeightCm(e.target.value)}
            placeholder="Alto cm" className="bg-muted border-border text-sm" />
        </div>
      </div>
      {/* Lot & Expiry */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm text-muted-foreground">N° de lote</label>
          <Input value={lotNumber} onChange={e => setLotNumber(e.target.value)} placeholder="Ej: LOT-2025-04" className="bg-muted border-border font-mono text-sm" />
        </div>
        <div>
          <label className="text-sm text-muted-foreground">Fecha de vencimiento</label>
          <Input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} className="bg-muted border-border text-sm" />
        </div>
      </div>
      {/* Tags */}
      <div>
        <label className="text-sm text-muted-foreground">Etiquetas</label>
        <div className="flex flex-wrap gap-1.5 mt-1 mb-2">
          {tags.map(t => (
            <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-primary/15 text-primary border border-primary/20">
              {t}
              <button type="button" onClick={() => setTags(tags.filter(x => x !== t))} className="hover:text-destructive ml-0.5">×</button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            onKeyDown={e => {
              if ((e.key === 'Enter' || e.key === ',') && tagInput.trim()) {
                e.preventDefault();
                const t = tagInput.trim().toLowerCase().replace(/[^a-z0-9áéíóúüñ-]/g, '');
                if (t && !tags.includes(t)) setTags([...tags, t]);
                setTagInput('');
              }
            }}
            placeholder="nuevo, importado, oferta... (Enter para agregar)"
            className="bg-muted border-border text-sm flex-1"
          />
          <Button type="button" variant="outline" size="sm" onClick={() => {
            const t = tagInput.trim().toLowerCase().replace(/[^a-z0-9áéíóúüñ-]/g, '');
            if (t && !tags.includes(t)) setTags([...tags, t]);
            setTagInput('');
          }}><Plus className="w-3.5 h-3.5" /></Button>
        </div>
        <div className="flex gap-1.5 mt-2 flex-wrap">
          {['nuevo', 'oferta', 'importado', 'exclusivo', 'temporada', 'agotándose'].filter(s => !tags.includes(s)).map(s => (
            <button key={s} type="button" onClick={() => setTags([...tags, s])}
              className="px-2 py-0.5 rounded-full text-[10px] bg-muted border border-border hover:border-primary/40 text-muted-foreground">
              + {s}
            </button>
          ))}
        </div>
      </div>

      {/* Variants — available for all categories */}
      <div className="border border-border rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setShowVariants(!showVariants)}
          className="w-full flex items-center justify-between px-3 py-2.5 bg-muted/40 hover:bg-muted/70 transition-colors text-sm font-medium"
        >
          <span className="flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-emerald-400" />
            {variantLabel}
            {variants.length > 0 && <span className="text-xs text-emerald-400 font-bold">({variants.length})</span>}
          </span>
          <span className="text-xs text-muted-foreground">{showVariants ? '▲' : '▼'}</span>
        </button>
      </div>
      {showVariants && (
        <div className="bg-muted/50 rounded-lg p-3 border border-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium flex items-center gap-1.5"><Layers className="w-3.5 h-3.5 text-emerald-400" />{variantLabel}</label>
              <Select value={variantType} onValueChange={setVariantType}>
                <SelectTrigger className="h-7 w-[92px] text-[10px]" aria-label="Tipo de variante"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sabor">Sabor</SelectItem>
                  <SelectItem value="talle">Talle</SelectItem>
                  <SelectItem value="color">Color</SelectItem>
                  <SelectItem value="medida">Medida</SelectItem>
                  <SelectItem value="otro">Otro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <button type="button" onClick={() => setShowBulkImport(!showBulkImport)} className="text-[10px] text-primary hover:underline">
              {showBulkImport ? 'Cerrar' : 'Importar lista'}
            </button>
          </div>
          {showBulkImport && (
            <div className="space-y-2 pb-12">
              <Input value={bulkVariants} onChange={e => setBulkVariants(e.target.value)} placeholder="Menta, Frutilla, Uva Ice, Sandía..." className="bg-muted border-border text-xs" />
              <Button type="button" variant="outline" size="sm" className="text-xs" onClick={() => {
                const names = bulkVariants.split(',').map(n => n.trim()).filter(Boolean);
                const existing = new Set(variants.map(v => v.variant_name.toLowerCase()));
                const newVars = names.filter(n => !existing.has(n.toLowerCase())).map(n => ({
                  variant_name: n, stock: 0, active: true, _new: true, price_override: null,
                }));
                setVariants([...variants, ...newVars]);
                setBulkVariants('');
                setShowBulkImport(false);
                if (newVars.length > 0) toast.success(`${newVars.length} sabores agregados`);
              }}>Agregar todos</Button>
            </div>
          )}
          <div className="flex gap-2 flex-wrap">
            <Input value={newVariantName} onChange={e => setNewVariantName(e.target.value)} placeholder="Nombre del sabor" className="bg-muted border-border text-xs flex-1 min-w-[120px]" />
            <Input type="number" min="0" value={newVariantStock} onChange={e => setNewVariantStock(e.target.value)} className="bg-muted border-border text-xs w-16" placeholder="Stock" disabled={variantsNeedLocation} title={variantsNeedLocation ? "Cargá el stock por depósito desde Sucursales" : undefined} />
            <Input type="number" min="0" step="0.01" value={newVariantPrice} onChange={e => setNewVariantPrice(e.target.value)} className="bg-muted border-border text-xs w-24" placeholder="Precio (opc)" />
            <Button type="button" variant="outline" size="sm" onClick={() => {
              if (!newVariantName.trim()) return;
              if (variants.some(v => v.variant_name.toLowerCase() === newVariantName.trim().toLowerCase())) {
                toast.error('Ese sabor ya existe'); return;
              }
              setVariants([...variants, { variant_name: newVariantName.trim(), stock: parseInt(newVariantStock) || 0, active: true, _new: true, price_override: parseFloat(newVariantPrice) || null }]);
              setNewVariantName(''); setNewVariantStock('0'); setNewVariantPrice('');
            }}><Plus className="w-3 h-3" /></Button>
          </div>
          {variants.length > 0 && (
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {variants.map((v, i) => (
                <div key={v.id || `new-${i}`} className="flex items-center gap-2 bg-card rounded p-2 border border-border flex-wrap">
                  <span className="text-xs font-medium flex-1 truncate min-w-[80px]">{v.variant_name}</span>
                  <div className="flex items-center gap-1">
                    <Input type="number" min="0" value={String(v.stock)} onChange={e => {
                      const updated = [...variants];
                      updated[i] = { ...updated[i], stock: parseInt(e.target.value) || 0 };
                      setVariants(updated);
                    }} className="bg-muted border-border text-xs w-14 h-7" disabled={variantsNeedLocation} title={variantsNeedLocation ? "Ajustá este stock por depósito desde Sucursales" : undefined} />
                    <span className="text-[10px] text-muted-foreground">uds</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-muted-foreground">$</span>
                    <Input type="number" min="0" step="0.01" value={v.price_override != null ? String(v.price_override) : ''} placeholder="Precio propio" onChange={e => {
                      const updated = [...variants];
                      updated[i] = { ...updated[i], price_override: parseFloat(e.target.value) || null };
                      setVariants(updated);
                    }} className="bg-muted border-border text-xs w-24 h-7" title="Precio propio de esta variante (sobreescribe el precio del producto)" />
                  </div>
                  <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0 shrink-0" onClick={() => {
                    setVariants(variants.filter((_, j) => j !== i));
                  }}><Trash2 className="w-3 h-3 text-destructive" /></Button>
                </div>
              ))}
              <p className="text-[10px] text-muted-foreground mt-1">
                Stock total (suma de variantes): <span className="font-bold text-emerald-400">{variants.reduce((s, v) => s + (v.stock || 0), 0)}</span>
              </p>
              {variantsNeedLocation && (
                <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">
                  Hay más de un depósito: el stock se ajusta por presentación y sucursal desde Sucursales &amp; Depósitos.
                </p>
              )}
            </div>
          )}
        </div>
      )}
      {(category === 'perfume_arabe' || category === 'perfume_diseñador') && (
        <Button type="button" variant="outline" size="sm" disabled={generatingDesc || !name.trim()} className="text-xs"
          onClick={async () => {
            setGeneratingDesc(true);
            try {
              const { data, error } = await supabase.functions.invoke('generate-description', {
                body: { name: name.trim(), brand: brand.trim(), category, gender, orgId }
              });
              if (error) throw error;
              if (data?.description) {
                setDescription(data.description);
                // Prefill de campos estructurados si la IA los devolvió
                if (data.familia_olfativa) setFamiliaOlfativa(data.familia_olfativa);
                if (Array.isArray(data.notas_salida) && data.notas_salida.length) setNotasSalida(data.notas_salida);
                if (Array.isArray(data.notas_corazon) && data.notas_corazon.length) setNotasCorazon(data.notas_corazon);
                if (Array.isArray(data.notas_fondo) && data.notas_fondo.length) setNotasFondo(data.notas_fondo);
                if (data.duracion) setDuracion(data.duracion);
                if (data.proyeccion) setProyeccion(data.proyeccion);
                if (Array.isArray(data.ocasion) && data.ocasion.length) setOcasion(data.ocasion);
                toast.success('Descripción y ficha generadas con IA');
              }
            } catch (err: any) { toast.error('Error generando descripción: ' + (err.message || 'Error desconocido')); }
            finally { setGeneratingDesc(false); }
          }}>
          <Sparkles className="w-3 h-3 mr-1" />{generatingDesc ? 'Generando...' : 'Generar con IA'}
        </Button>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex items-center gap-2 bg-muted rounded-lg p-3 border border-border">
          <input type="checkbox" checked={featured} onChange={e => setFeatured(e.target.checked)} id="featured" className="rounded" />
          <label htmlFor="featured" className="text-sm flex items-center gap-1 cursor-pointer">
            <Star className="w-3.5 h-3.5 text-primary" />Destacado
          </label>
        </div>
        <div className="flex items-center gap-2 bg-muted rounded-lg p-3 border border-border">
          <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} id="isActive" className="rounded" />
          <label htmlFor="isActive" className="text-sm flex items-center gap-1 cursor-pointer">
            <Check className="w-3.5 h-3.5 text-emerald-400" />Activo
          </label>
        </div>
      </div>
      {/* Sólo tiene sentido si el producto está en oferta: sin precio rebajado
          no hay nada con qué acumular. */}
      {parseFloat(discountPriceARS) > 0 && (
        <div>
          <label className="text-sm text-muted-foreground">Descuento por transferencia/efectivo</label>
          <Select
            value={offerStacks === null ? 'tienda' : offerStacks ? 'suma' : 'incluido'}
            onValueChange={v => setOfferStacks(v === 'tienda' ? null : v === 'suma')}
          >
            <SelectTrigger className="bg-muted border-border text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="tienda">Como diga la tienda (por defecto)</SelectItem>
              <SelectItem value="incluido">La oferta YA es el precio con descuento</SelectItem>
              <SelectItem value="suma">Se suma a la oferta (liquidación real)</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground mt-1">
            {offerStacks === true
              ? 'Al precio de oferta se le aplica además el % del medio de pago.'
              : offerStacks === false
              ? 'El precio de oferta es el final: no se descuenta dos veces.'
              : 'Usa la política configurada en Tienda online → Configuración.'}
          </p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm text-muted-foreground">Oferta hasta</label>
          <Input type="datetime-local" value={offerExpiresAt} onChange={e => setOfferExpiresAt(e.target.value)} className="bg-muted border-border text-xs" />
        </div>
        <div>
          <label className="text-sm text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" />Próximo ingreso</label>
          <Input type="date" value={expectedRestockAt} onChange={e => setExpectedRestockAt(e.target.value)} className="bg-muted border-border text-xs" />
        </div>
      </div>
      {cost > 0 && salePrice > 0 && (
        <div className="bg-muted rounded-lg p-4 space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Costo base:</span><span>{formatUSD(cost)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">+{customsPercent}% Pasero:</span><span className="text-yellow-400">{formatUSD(customsFee)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Costo total:</span><span>{formatUSD(totalCostUSD)} = {formatARS(totalCostARS)}</span></div>
          <div className="flex justify-between font-bold border-t border-border pt-1"><span>Ganancia/u:</span>
            <span className={profitPerUnitARS > 0 ? 'text-emerald-400' : 'text-destructive'}>{formatARS(profitPerUnitARS)} ({formatUSD(profitPerUnitUSD)})</span>
          </div>
          {parseFloat(discountPriceARS) > 0 && (
            <div className="flex justify-between text-xs border-t border-border pt-1">
              <span className="text-muted-foreground">Ganancia c/desc:</span>
              <span className={parseFloat(discountPriceARS) - totalCostARS > 0 ? 'text-emerald-400' : 'text-destructive'}>
                {formatARS(parseFloat(discountPriceARS) - totalCostARS)}
              </span>
            </div>
          )}
        </div>
      )}
      {attributeDefinitions.length > 0 && (
        <div className="space-y-3 border-t border-primary/20 pt-4">
          <div>
            <p className="text-xs font-semibold text-primary uppercase tracking-wide">Atributos del tipo</p>
            <p className="text-[11px] text-muted-foreground mt-1">Datos estructurados para búsquedas, filtros y futuros canales.</p>
          </div>
          {attributeDefinitions.map(definition => {
            const rawValue = attributeValues[definition.id];
            const displayValue = Array.isArray(rawValue) ? rawValue.join(", ") : rawValue ?? "";
            const setValue = (value: unknown) => setAttributeValues(values => ({ ...values, [definition.id]: value }));
            return (
              <div key={definition.id}>
                <label className="text-sm text-muted-foreground block mb-1">
                  {definition.name}{definition.unit ? ` (${definition.unit})` : ""}
                  {definition.required && <span className="text-destructive ml-0.5">*</span>}
                </label>
                {definition.data_type === "text" && <Input value={String(displayValue)} onChange={event => setValue(event.target.value)} className="bg-muted border-border" />}
                {definition.data_type === "number" && <Input type="number" value={String(displayValue)} onChange={event => setValue(event.target.value === "" ? "" : Number(event.target.value))} className="bg-muted border-border" />}
                {definition.data_type === "date" && <Input type="date" value={String(displayValue)} onChange={event => setValue(event.target.value)} className="bg-muted border-border" />}
                {definition.data_type === "boolean" && (
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <input type="checkbox" checked={rawValue === true} onChange={event => setValue(event.target.checked)} className="w-4 h-4 accent-primary" /> Activado
                  </label>
                )}
                {definition.data_type === "select" && (
                  <Select value={String(displayValue)} onValueChange={setValue}>
                    <SelectTrigger className="bg-muted border-border"><SelectValue placeholder="Seleccioná..." /></SelectTrigger>
                    <SelectContent>{definition.options.map(option => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent>
                  </Select>
                )}
                {definition.data_type === "multiselect" && (
                  <Input value={String(displayValue)} onChange={event => setValue(event.target.value.split(",").map(value => value.trim()).filter(Boolean))} placeholder="Separá los valores con coma" className="bg-muted border-border" />
                )}
              </div>
            );
          })}
        </div>
      )}
      {/* Custom fields */}
      {customFieldDefs.length > 0 && (
        <div className="space-y-3 border-t border-border/50 pt-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Campos personalizados</p>
          {customFieldDefs.map((def: any) => (
            <div key={def.id}>
              <label className="text-sm text-muted-foreground block mb-1">
                {def.field_label}
                {def.required && <span className="text-destructive ml-0.5">*</span>}
              </label>
              {def.field_type === 'text' && (
                <Input
                  value={customFieldValues[def.field_key] ?? ""}
                  onChange={e => setCustomFieldValues(v => ({ ...v, [def.field_key]: e.target.value }))}
                  className="bg-muted border-border"
                />
              )}
              {def.field_type === 'number' && (
                <Input
                  type="number"
                  value={customFieldValues[def.field_key] ?? ""}
                  onChange={e => setCustomFieldValues(v => ({ ...v, [def.field_key]: e.target.value ? Number(e.target.value) : "" }))}
                  className="bg-muted border-border"
                />
              )}
              {def.field_type === 'date' && (
                <Input
                  type="date"
                  value={customFieldValues[def.field_key] ?? ""}
                  onChange={e => setCustomFieldValues(v => ({ ...v, [def.field_key]: e.target.value }))}
                  className="bg-muted border-border"
                />
              )}
              {def.field_type === 'boolean' && (
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!!customFieldValues[def.field_key]}
                    onChange={e => setCustomFieldValues(v => ({ ...v, [def.field_key]: e.target.checked }))}
                    className="w-4 h-4 accent-primary"
                  />
                  <span className="text-sm text-muted-foreground">Activado</span>
                </div>
              )}
              {def.field_type === 'select' && def.options && (
                <Select
                  value={customFieldValues[def.field_key] ?? ""}
                  onValueChange={v => setCustomFieldValues(vals => ({ ...vals, [def.field_key]: v }))}
                >
                  <SelectTrigger className="bg-muted border-border">
                    <SelectValue placeholder="Seleccioná..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(def.options as string[]).map((opt: string) => (
                      <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          ))}
        </div>
      )}
      {product?.id && orgId && (
        <MercadoLibrePublishCard
          productId={product.id}
          orgId={orgId}
          productCategory={product.category}
        />
      )}
      <Button type="submit" disabled={uploading} className="w-full gradient-gold text-primary-foreground font-semibold">{uploading ? 'Subiendo imagen...' : product ? 'Guardar' : 'Agregar'}</Button>
    </form>
  );
}

interface MeliCategoryCandidate {
  id: string;
  name: string;
  domain: string | null;
}

interface MeliProductListing {
  meli_item_id: string;
  permalink: string | null;
  status: string;
}

/**
 * Publicar vive dentro de la ficha ya guardada: así la Edge Function puede
 * tomar título, precio y stock de la fuente de verdad y no de un borrador del
 * navegador. El predictor propone; la categoría se confirma explícitamente.
 */
function MercadoLibrePublishCard({ productId, orgId, productCategory }: {
  productId: string;
  orgId: string;
  productCategory: string | null;
}) {
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [listing, setListing] = useState<MeliProductListing | null>(null);
  const [categories, setCategories] = useState<MeliCategoryCandidate[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [busy, setBusy] = useState<"predict" | "publish" | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const [connectionRes, listingRes] = await Promise.all([
        supabase.from("meli_connection_status").select("conectado").eq("org_id", orgId).maybeSingle(),
        supabase.from("meli_listings")
          .select("meli_item_id, permalink, status")
          .eq("org_id", orgId).eq("product_id", productId).maybeSingle(),
      ]);
      if (cancelled) return;
      if (connectionRes.error || listingRes.error) {
        const error = connectionRes.error ?? listingRes.error;
        toast.error(`No se pudo cargar MercadoLibre: ${error?.message ?? "error desconocido"}`);
      }
      if (!connectionRes.error) setConnected(!!connectionRes.data?.conectado);
      if (!listingRes.error) setListing((listingRes.data as MeliProductListing | null) ?? null);
      setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [orgId, productId]);

  const invoke = async (action: "predict-category" | "publish", extra: Record<string, unknown> = {}) => {
    setBusy(action === "predict-category" ? "predict" : "publish");
    const { data, error } = await supabase.functions.invoke("meli-sync", {
      body: { action, orgId, productId, ...extra },
    });
    setBusy(null);
    const result = data as any;
    const message = await mensajeDeEdgeFunction(error, result);
    if (message) {
      toast.error(message);
      return null;
    }
    return result;
  };

  const predict = async () => {
    const result = await invoke("predict-category");
    if (!result) return;
    const suggested = (result.categories ?? []) as MeliCategoryCandidate[];
    setCategories(suggested);
    setSelectedCategoryId(suggested[0]?.id ?? "");
  };

  const publish = async () => {
    if (!selectedCategoryId) {
      toast.error("Elegí una categoría de MercadoLibre antes de publicar");
      return;
    }
    const result = await invoke("publish", { categoryId: selectedCategoryId });
    if (!result) return;
    const nextListing: MeliProductListing = {
      meli_item_id: result.item_id,
      permalink: result.permalink ?? null,
      status: result.status ?? "active",
    };
    setListing(nextListing);
    toast.success(result.already_published ? "Este producto ya estaba publicado" : "Producto publicado en MercadoLibre");
  };

  if (productCategory === "vaper") {
    return (
      <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3">
        <p className="text-xs text-amber-500 font-medium">MercadoLibre no permite publicar vapers.</p>
        <p className="text-[11px] text-muted-foreground mt-1">La protección también corre en el servidor para evitar una sanción por error.</p>
      </div>
    );
  }

  if (loading) {
    return <div className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" />Cargando MercadoLibre…</div>;
  }

  if (listing) {
    return (
      <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-emerald-500">Publicado en MercadoLibre</p>
          <p className="text-[11px] text-muted-foreground">{listing.meli_item_id} · {listing.status}</p>
        </div>
        {listing.permalink && (
          <a href={listing.permalink} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline inline-flex items-center gap-1 shrink-0">
            Ver publicación <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
        <p className="text-xs font-medium">Publicar en MercadoLibre</p>
        <p className="text-[11px] text-muted-foreground mt-1">Primero conectá la cuenta en Integraciones → Conexiones.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/70 bg-muted/20 p-3 space-y-3">
      <div>
        <p className="text-xs font-semibold">Publicar en MercadoLibre</p>
        <p className="text-[11px] text-muted-foreground mt-1">La categoría se sugiere con el título guardado; revisala antes de publicar.</p>
      </div>
      {categories.length === 0 ? (
        <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={predict}>
          {busy === "predict" ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <ShoppingCart className="w-3.5 h-3.5 mr-1.5" />}
          Sugerir categoría
        </Button>
      ) : (
        <>
          <div className="space-y-1.5">
            {categories.map((candidate, index) => (
              <label key={candidate.id} className="flex items-start gap-2 rounded border border-border/60 bg-background/40 p-2 text-xs cursor-pointer">
                <input
                  type="radio"
                  name={`meli-category-${productId}`}
                  value={candidate.id}
                  checked={selectedCategoryId === candidate.id}
                  onChange={() => setSelectedCategoryId(candidate.id)}
                  className="mt-0.5 accent-primary"
                />
                <span>
                  <span className="font-medium">{candidate.name}</span>
                  {index === 0 && <span className="ml-1.5 text-[10px] text-primary">Sugerida</span>}
                  {candidate.domain && <span className="block text-[10px] text-muted-foreground">{candidate.domain}</span>}
                </span>
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={busy !== null} onClick={publish}>
              {busy === "publish" && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
              Confirmar y publicar
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy !== null} onClick={predict}>Cambiar sugerencia</Button>
          </div>
        </>
      )}
    </div>
  );
}

function BulkPriceAdjust({ userId, settings, categorias, onDone }: { userId: string; settings: any; categorias: OpcionCategoria[]; onDone: () => void }) {
  const [category, setCategory] = useState('all');
  const [percent, setPercent] = useState('');
  const [field, setField] = useState('both');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'percent' | 'recalc'>('percent');
  const [newExchangeRate, setNewExchangeRate] = useState(String(settings?.exchange_rate || 1700));
  // El markup se expresa en % (100% = ×2). Se prellena con el markup
  // configurado para la categoría elegida, para no pisarlo sin querer.
  const [recalcMarkup, setRecalcMarkup] = useState(String((getCategoryMarkup(settings, null) - 1) * 100));
  useEffect(() => {
    if (category === 'all') return;
    setRecalcMarkup(String(Math.round((getCategoryMarkup(settings, category) - 1) * 100)));
  }, [category, settings]);

  const handleRecalc = async () => {
    const xRate = parseFloat(newExchangeRate);
    const markup = parseFloat(recalcMarkup);
    if (!xRate || xRate <= 0) { toast.error("Ingresá un tipo de cambio válido"); return; }
    if (!markup || markup < 0) { toast.error("Ingresá un markup válido"); return; }
    setLoading(true);
    try {
      const allProducts = await getProductsDB(userId);
      const toUpdate = category === 'all' ? allProducts : allProducts.filter(p => p.category === category);
      const customsPct = Number(settings?.customs_percent || 15);
      let count = 0;
      for (const p of toUpdate) {
        const costUSD = Number(p.cost_usd) || 0;
        if (!costUSD) continue;
        const costImported = costUSD * (1 + customsPct / 100) * xRate;
        const newSalePrice = Math.round(costImported * (1 + markup / 100));
        const { profitPerUnitARS, profitPerUnitUSD } = calculateProductProfits(costUSD, customsPct, newSalePrice, xRate);
        await updateProductDB(p.id, {
          sale_price_ars: newSalePrice,
          profit_per_unit_ars: profitPerUnitARS,
          profit_per_unit_usd: profitPerUnitUSD,
        });
        count++;
      }
      // Also save the new exchange rate to settings
      await import('@/lib/supabaseStore').then(m => m.saveSettingsDB(userId, { exchange_rate: xRate }));
      toast.success(`${plural(count, "producto")} recalculados a $${xRate}/U$S`);
      onDone();
    } catch (err: any) {
      toast.error("Error: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    const pct = parseFloat(percent);
    if (!pct || pct === 0) { toast.error("Ingresá un porcentaje válido"); return; }
    setLoading(true);
    try {
      const products = await getProductsDB(userId);
      const toUpdate = category === 'all' ? products : products.filter(p => p.category === category);
      let count = 0;
      for (const p of toUpdate) {
        const updates: any = {};
        if ((field === 'sale' || field === 'both') && Number(p.sale_price_ars) > 0) {
          updates.sale_price_ars = Math.round(Number(p.sale_price_ars) * (1 + pct / 100));
        }
        if ((field === 'discount' || field === 'both') && Number(p.discount_price_ars) > 0) {
          updates.discount_price_ars = Math.round(Number(p.discount_price_ars) * (1 + pct / 100));
        }
        // Recalculate profits
        if (updates.sale_price_ars !== undefined) {
          // ⚠️ Sin cotización no se recalcula la ganancia de un producto en
          // dólares: escribir un número derivado de un dólar inventado deja el
          // dato mal en la base, que es peor que dejarlo como estaba.
          const cotizacionInline = cotizacionDe(settings);
          if (cotizacionInline === null && Number(p.cost_usd) > 0) return;
          const exchangeRate = cotizacionInline ?? 0;
          const { profitPerUnitARS, profitPerUnitUSD } = calculateProductProfits(
            Number(p.cost_usd), Number(settings?.customs_percent || 15), updates.sale_price_ars, exchangeRate
          );
          updates.profit_per_unit_ars = profitPerUnitARS;
          updates.profit_per_unit_usd = profitPerUnitUSD;
        }
        if (Object.keys(updates).length > 0) {
          await updateProductDB(p.id, updates);
          count++;
        }
      }
      toast.success(`${plural(count, "producto")} actualizados (${pct > 0 ? '+' : ''}${pct}%)`);
      onDone();
    } catch (err: any) {
      toast.error("Error: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 pb-12">
      {/* Mode switcher */}
      <div className="flex rounded-lg overflow-hidden border border-border/50 p-0.5 gap-0.5 bg-muted/30">
        <button
          type="button"
          onClick={() => setMode('percent')}
          className={`flex-1 text-xs py-1.5 px-3 rounded-md font-medium transition-colors ${mode === 'percent' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
        >
          % Ajuste porcentual
        </button>
        <button
          type="button"
          onClick={() => setMode('recalc')}
          className={`flex-1 text-xs py-1.5 px-3 rounded-md font-medium transition-colors ${mode === 'recalc' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
        >
          Recalcular por TC
        </button>
      </div>

      {/* Category selector (shared by both modes) */}
      <div>
        <label className="text-sm text-muted-foreground">Categoría</label>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
          <SelectContent>
            {/* Las del comercio. Hasta 2026-08-26 eran los cuatro slugs de
                perfumería escritos a mano, así que el ajuste masivo por
                categoría era inservible para cualquier otro rubro: sólo
                quedaba "Todas". */}
            <SelectItem value="all">Todas las categorías</SelectItem>
            {categorias.map(o => (
              <SelectItem key={o.slug} value={o.slug}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {mode === 'percent' ? (
        <>
          <div>
            <label className="text-sm text-muted-foreground">Campo a modificar</label>
            <Select value={field} onValueChange={setField}>
              <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="both">Venta + Descuento</SelectItem>
                <SelectItem value="sale">Solo Precio Venta</SelectItem>
                <SelectItem value="discount">Solo Precio Descuento</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm text-muted-foreground">Porcentaje (+ para subir, - para bajar)</label>
            <Input type="number" value={percent} onChange={e => setPercent(e.target.value)} placeholder="Ej: 10 o -15" className="bg-muted border-border" />
          </div>
          <Button onClick={handleApply} disabled={loading} className="w-full gradient-gold text-primary-foreground font-semibold">
            {loading ? 'Aplicando...' : 'Aplicar Ajuste'}
          </Button>
        </>
      ) : (
        <>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Recalcula el precio de venta desde cero usando <strong>costo USD × TC × markup</strong>. Solo afecta productos con costo en USD cargado. También actualiza el tipo de cambio en configuración.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-muted-foreground">Nuevo tipo de cambio</label>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-mono">$</span>
                <Input
                  type="number"
                  min="1"
                  value={newExchangeRate}
                  onChange={e => setNewExchangeRate(e.target.value)}
                  className="pl-7 bg-muted border-border"
                  placeholder="1700"
                />
              </div>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Markup sobre costo importado</label>
              <div className="relative">
                <Input
                  type="number"
                  min="0"
                  step="5"
                  value={recalcMarkup}
                  onChange={e => setRecalcMarkup(e.target.value)}
                  className="bg-muted border-border"
                  placeholder="100"
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
              </div>
            </div>
          </div>
          {/* Live preview */}
          {parseFloat(newExchangeRate) > 0 && parseFloat(recalcMarkup) >= 0 && (
            <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 text-xs space-y-1">
              <p className="font-semibold text-primary">Vista previa (ej: costo U$S 10)</p>
              {(() => {
                const xR = parseFloat(newExchangeRate);
                const mk = parseFloat(recalcMarkup);
                const customs = Number(settings?.customs_percent || 15);
                const costImported = 10 * (1 + customs / 100) * xR;
                const salePrice = Math.round(costImported * (1 + mk / 100));
                const margin = salePrice > 0 ? ((salePrice - costImported) / salePrice * 100).toFixed(1) : '0';
                return (
                  <p className="text-muted-foreground">
                    U$S 10 → <span className="text-foreground font-mono">${costImported.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span> importado → venta <span className="text-primary font-mono font-bold">${salePrice.toLocaleString('es-AR')}</span> · margen <span className="text-green-400">{margin}%</span>
                  </p>
                );
              })()}
            </div>
          )}
          <Button onClick={handleRecalc} disabled={loading} className="w-full gradient-gold text-primary-foreground font-semibold">
            {loading ? 'Recalculando...' : `Recalcular a $${parseFloat(newExchangeRate).toLocaleString('es-AR') || '?'}/U$S`}
          </Button>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Price History Modal
// ─────────────────────────────────────────────────────────────
export function PriceHistoryModal({ productId, productName, open, onClose }: {
  productId: string; productName: string; open: boolean; onClose: () => void;
}) {
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !productId) return;
    let cancelled = false;
    const loadHistory = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from("price_history")
          .select("*")
          .eq("product_id", productId)
          .order("created_at", { ascending: false })
          .limit(20);
        if (error) throw error;

        const rows = data ?? [];
        const actorIds = [...new Set(rows.map(h => h.changed_by).filter(Boolean))] as string[];
        const names: Record<string, string> = {};
        if (actorIds.length) {
          const { data: profiles, error: profilesError } = await supabase
            .from("profiles")
            .select("user_id, display_name")
            .in("user_id", actorIds);
          if (profilesError) throw profilesError;
          for (const profile of profiles ?? []) {
            names[profile.user_id] = profile.display_name || "Usuario sin nombre";
          }
        }
        if (!cancelled) {
          setHistory(rows.map(h => ({
            ...h,
            actor_name: h.changed_by ? names[h.changed_by] ?? "Usuario sin perfil" : "Sistema o historial previo",
          })));
        }
      } catch (error: any) {
        if (!cancelled) {
          setHistory([]);
          toast.error(error.message ?? "No se pudo cargar el historial de precios");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void loadHistory();
    return () => { cancelled = true; };
  }, [open, productId]);

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="bg-card border-border max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-sm">Historial de precios — {productName}</DialogTitle>
        </DialogHeader>
        {loading ? (
          <p className="text-sm text-muted-foreground text-center py-6">Cargando…</p>
        ) : history.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">Sin cambios de precio registrados aún.<br />Los cambios futuros aparecerán acá automáticamente.</p>
        ) : (
          <div className="space-y-2 pb-12">
            {history.map((h: any) => {
              const pct = Number(h.change_pct);
              const up = pct > 0;
              return (
                <div key={h.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border/40 text-xs">
                  <div className="flex-1 min-w-0">
                    <p className="text-muted-foreground">{new Date(h.created_at).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" })}</p>
                    <p className="font-medium">
                      {h.old_price_ars ? formatARS(Number(h.old_price_ars)) : "—"} → <span className="text-primary font-bold">{formatARS(Number(h.new_price_ars))}</span>
                    </p>
                    <p className="text-muted-foreground mt-0.5">Responsable: {h.actor_name}</p>
                  </div>
                  {h.change_pct != null && (
                    <span className={`font-bold shrink-0 ${up ? "text-emerald-400" : "text-destructive"}`}>
                      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}%
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
