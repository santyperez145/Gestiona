import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { cotizacionDe } from "@/lib/exchangeRate";
import { useOrg } from "@/lib/orgContext";
import { supabase } from "@/integrations/supabase/client";
import { motivoDeRespuesta } from "@/lib/ia";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Brain, Send, Loader2, Trash2, Bot, User, Sparkles, ShoppingCart,
  Package, Users, BarChart2, DollarSign, Zap, Plus, CheckCircle2, X,
  TrendingDown, History, MessageSquare, ChevronLeft, ClipboardList, Download,
  ImagePlus, Camera,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { addProductDB, addExpenseDB, createCustomerDB, getProductsDB, setStockAbsoluteDB, addSaleDB, addPurchaseDB, getSettingsDB, formatARS } from "@/lib/supabaseStore";
import { requireActiveOrgId } from "@/lib/orgContext";
import KPICard from "@/components/shared/KPICard";

// ─── Types ────────────────────────────────────────────────────────────────────
type ActionType = "create_product" | "create_expense" | "create_customer" | "adjust_stock" | "navigate" | "create_sale" | "create_purchase" | "query_debt" | "query_stock" | "query_product_analysis" | "query_restock" | "create_task" | "create_quote" | "query_customer" | "query_sales_summary" | "send_wa_segment" | "query_debts_summary" | "query_top_products" | "query_expense_summary" | "query_supplier";

type AIAction =
  | { type: "create_product"; name?: string; price?: string; category?: string }
  | { type: "create_expense"; description?: string; amount?: string; category?: string }
  | { type: "create_customer"; name?: string; phone?: string; email?: string }
  | { type: "adjust_stock"; productName?: string; quantity?: string }
  | { type: "create_sale"; productName?: string; quantity?: string; customer?: string }
  | { type: "create_purchase"; productName?: string; quantity?: string; supplier?: string; costUSD?: string }
  | { type: "query_debt"; customerName?: string }
  | { type: "query_stock"; productName?: string }
  | { type: "query_product_analysis"; productName?: string }
  | { type: "query_restock" }
  | { type: "create_task" }
  | { type: "create_quote"; customerName?: string; productName?: string; amount?: string }
  | { type: "query_customer"; customerName?: string }
  | { type: "query_sales_summary"; period?: "today" | "week" | "month" }
  | { type: "send_wa_segment"; segment?: string }
  | { type: "query_debts_summary" }
  | { type: "query_top_products"; sortBy?: "revenue" | "profit" | "units" }
  | { type: "query_expense_summary"; period?: "month" | "week" }
  | { type: "query_supplier"; supplierName?: string }
  | { type: "navigate"; path: string; label: string };

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts: number;
  action?: AIAction;
  streaming?: boolean; // true while SSE stream is in progress
};

// ─── Intent detection ─────────────────────────────────────────────────────────
function detectIntent(msg: string): AIAction | null {
  const lower = msg.toLowerCase();

  // Create product
  if (/\b(crea(r)?|agrega(r)?|añadi(r)?|nuevo)\b.{0,25}\bproducto\b/.test(lower)) {
    const nameMatch = msg.match(/producto\s+[""']?([^""',\n]+)[""']?/i);
    const priceMatch = msg.match(/\$?\s*(\d[\d.,]*)/);
    return {
      type: "create_product",
      name: nameMatch?.[1]?.trim(),
      price: priceMatch?.[1]?.replace(/\./g, "").replace(",", "."),
    };
  }

  // Create expense
  if (/\b(carga(r)?|registra(r)?|agrega(r)?|anota(r)?)\b.{0,25}\bgasto\b/.test(lower)) {
    const descMatch = msg.match(/gasto\s+(?:de\s+)?[""']?([^""',\n$]+)/i);
    const amountMatch = msg.match(/\$?\s*(\d[\d.,]*)/);
    return {
      type: "create_expense",
      description: descMatch?.[1]?.trim(),
      amount: amountMatch?.[1]?.replace(/\./g, "").replace(",", "."),
    };
  }

  // Create customer
  if (/\b(crea(r)?|agrega(r)?|añadi(r)?|nuevo)\b.{0,25}\bcliente\b/.test(lower)) {
    const nameMatch = msg.match(/cliente\s+(?:llamad[oa]\s+)?[""']?([A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]+(?:\s+[A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]+)*)/i);
    const phoneMatch = msg.match(/(?:tel[eé]fono|cel|whatsapp)?\s*:?\s*(\+?54\s?\d[\d\s-]{6,})/i);
    return {
      type: "create_customer",
      name: nameMatch?.[1]?.trim(),
      phone: phoneMatch?.[1]?.replace(/\s/g, ""),
    };
  }

  // Adjust stock
  if (/\b(ajusta(r)?|modifica(r)?|cambia(r)?|subi(r)?|baja(r)?|carga(r)?)\b.{0,30}\bstock\b/.test(lower) ||
      /\bstock\b.{0,30}\b(ajusta(r)?|modifica(r)?|cambia(r)?)\b/.test(lower)) {
    const qtyMatch = msg.match(/(\d+)\s*(?:unidades?|piezas?|u\.?)?/);
    return {
      type: "adjust_stock",
      quantity: qtyMatch?.[1],
    };
  }

  // Create sale
  if (/\b(registra(r)?|carga(r)?|anota(r)?|hace(r)?|realiza(r)?)\b.{0,25}\bventa\b/.test(lower) ||
      /\bvend[ií]\b/.test(lower)) {
    const qtyMatch = msg.match(/(\d+)\s*(?:unidades?|piezas?|u\.?)/i);
    const customerMatch = msg.match(/(?:a|para)\s+([A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]+(?:\s+[A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]+)?)/i);
    return {
      type: "create_sale",
      quantity: qtyMatch?.[1],
      customer: customerMatch?.[1]?.trim(),
    };
  }

  // Create purchase
  if (/\b(registra(r)?|carga(r)?|anota(r)?)\b.{0,30}\bcompra\b/.test(lower) ||
      /\bcompr[eé]\b/.test(lower) || /\bllegó\s+(?:un[ao]?\s+)?(?:pedido|compra|stock)\b/.test(lower)) {
    const qtyMatch = msg.match(/(\d+)\s*(?:unidades?|piezas?|u\.?)/i);
    const supplierMatch = msg.match(/(?:de|a|proveedor)\s+([A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ\s]+?)(?:\s+por|\s+a\s*\$|,|$)/i);
    const costMatch = msg.match(/(?:usd?|u\$s?|dólares?|\$u)\s*(\d[\d.,]*)/i);
    return {
      type: "create_purchase",
      quantity: qtyMatch?.[1],
      supplier: supplierMatch?.[1]?.trim(),
      costUSD: costMatch?.[1]?.replace(/\./g, "").replace(",", "."),
    };
  }

  // Query customer debt
  if (/\b(cuánto\s+debe|deuda\s+de|debe\s+cuánto|saldo\s+de|fiado\s+de|adeuda)\b/.test(lower) ||
      /\b(cuánto\s+(?:me\s+)?(?:debe|adeuda))\b/.test(lower)) {
    const nameMatch = msg.match(/(?:debe|deuda\s+de|saldo\s+de|fiado\s+de|adeuda)\s+([A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]+(?:\s+[A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]+)?)/i);
    return { type: "query_debt", customerName: nameMatch?.[1]?.trim() };
  }

  // Query product stock
  if (/\b(cuánto\s+(?:stock|tengo|hay|queda)|stock\s+de|tengo\s+de)\b/.test(lower)) {
    const productMatch = msg.match(/(?:de|stock\s+de|tengo\s+de)\s+([a-záéíóúüñA-ZÁÉÍÓÚÜÑ][a-záéíóúüñA-ZÁÉÍÓÚÜÑ\s]+?)(?:\?|$)/i);
    return { type: "query_stock", productName: productMatch?.[1]?.trim() };
  }

  // Analyze product performance
  if (/\b(anali[zs]a(r)?|cómo\s+va|qué\s+tal\s+(?:va|está)|rendimiento\s+de|performance\s+de|informe\s+de)\b.{0,40}\b(producto|perfume|vaper|artículo)\b/.test(lower) ||
      /\b(cómo\s+va|qué\s+tal\s+va|analiza(r)?)\s+(?:el\s+producto\s+)?["']?([a-záéíóúüñA-ZÁÉÍÓÚÜÑ0-9][^?"']{2,}?)["']?(?:\?|$)/.test(lower)) {
    const nameMatch = msg.match(/(?:analiz[ae](?:r)?|cómo va|qué tal va|informe de|rendimiento de|performance de)\s+(?:el\s+(?:producto\s+)?)?["']?([^"'?\n]{2,40}?)["']?\s*(?:\?|$)/i);
    return { type: "query_product_analysis", productName: nameMatch?.[1]?.trim() };
  }

  // Restock suggestion
  if (/\b(reponer|restock|reabastecer|repuesto|reabastecimiénto|comprar|pedir|order(?:ar)?)\b.{0,30}\b(stock|producto|mercadería|mercancía|inventario)\b/.test(lower) ||
      /\bqué\s+(me\s+)?(falta|debería\s+(?:comprar|pedir|reponer)|hay\s+que\s+(?:comprar|pedir|reponer))\b/.test(lower) ||
      /\b(productos?\s+(?:con\s+)?(?:bajo\s+stock|sin\s+stock|agotad[oa]s?|faltantes?)|qué\s+(?:me\s+)?queda\s+poco)\b/.test(lower)) {
    return { type: "query_restock" };
  }

  // Create task
  if (/\b(crea(r)?|agrega(r)?|nueva?|añadi(r)?)\s+(una?\s+)?(tarea|recordatorio|pendiente|actividad|to[-\s]?do)\b/.test(lower) ||
      /\b(recordarme?|recordá(me)?|anotá|apuntá)\s+(que|esto|una tarea)?\b/.test(lower)) {
    return { type: "create_task" };
  }

  // Query customer profile / analysis
  if (/\b(cómo\s+(va|está|anda)|info\s+de|datos\s+de|perfil\s+de|ver\s+(?:al?\s+)?cliente|anali[zs]a(r)?\s+(?:al?\s+)?cliente)\b/.test(lower) ||
      /\b(cliente|perfil|ficha)\b.{0,20}\b(info|datos|detalle|resumen|historial|análisis)\b/.test(lower)) {
    const nameMatch = msg.match(/(?:de|del?\s+cliente|cliente|perfil\s+de|ver\s+a|anali[zs][ae]r?\s+a(?:l?\s+cliente)?\s+)([A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]+(?:\s+[A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]+)?)/i);
    return { type: "query_customer", customerName: nameMatch?.[1]?.trim() };
  }

  // Total debts summary
  if (/\b(resumen\s+(de\s+)?(deudas?|cobros?)|total\s+(de\s+)?(deudas?|pendientes?|cobros?)|cuánto\s+(me\s+)?deben\s+en\s+total|deudas?\s+total(es)?|cartera\s+(de\s+)?cobros?)\b/.test(lower)) {
    return { type: "query_debts_summary" };
  }

  // Query sales summary
  if (/\b(cómo\s+(me\s+)?(fue|va|voy|estoy)|resumen\s+(de\s+)?ventas|cuánto\s+vendí|vendí\s+(hoy|ayer|esta\s+semana|este\s+mes)|ventas\s+(de\s+)?(hoy|ayer|esta\s+semana|este\s+mes)|cuánto\s+(gané|facturé|ingresé))\b/.test(lower)) {
    const period: "today" | "week" | "month" =
      /\b(semana|semanal)\b/.test(lower) ? "week" :
      /\b(mes|mensual)\b/.test(lower) ? "month" : "today";
    return { type: "query_sales_summary", period };
  }

  // Send WhatsApp to segment
  if (/\b(manda(r)?|envia(r)?|enviar|notifica(r)?)\b.{0,30}\b(whatsapp|mensaje|wa|wpp)\b/.test(lower) ||
      /\b(whatsapp|mensaje|wa|wpp)\b.{0,30}\b(clientes?|segmento|vip|dormidos?|en\s+riesgo|perdidos?|frecuentes?)\b/.test(lower)) {
    const segMatch = lower.match(/\b(vip|dormidos?|en\s+riesgo|perdidos?|frecuentes?|activos?|nuevos?|premium)\b/);
    const seg = segMatch ? segMatch[1].charAt(0).toUpperCase() + segMatch[1].slice(1).replace(/s$/, "") : undefined;
    return { type: "send_wa_segment", segment: seg };
  }

  // Expense summary
  if (/\b(cu[aá]nto\s+(gast[eé]|sali[oó])|resumen\s+(de\s+)?gastos?|mis\s+gastos?|gastos?\s+(de\s+)?(este\s+mes|esta\s+semana|del\s+mes|total)|en\s+qu[eé]\s+(gast[eé])|an[aá]lisis\s+(de\s+)?gastos?)\b/.test(lower)) {
    const period: "month" | "week" = /\b(semana|semanal)\b/.test(lower) ? "week" : "month";
    return { type: "query_expense_summary", period };
  }

  // Top products
  if (/\b(cu[aá]les?\s+(son\s+)?(mis\s+)?(mejores?|top|principales?)\s+productos?|productos?\s+(m[aá]s\s+)?(vendidos?|rentables?|populares?)|ranking\s+(de\s+)?productos?|mejores?\s+productos?)\b/.test(lower)) {
    const sortBy: "revenue" | "profit" | "units" =
      /\b(rentab|ganancia|margen|profit)\b/.test(lower) ? "profit" :
      /\b(unidades?|cantidad|más\s+vendidos?)\b/.test(lower) ? "units" : "revenue";
    return { type: "query_top_products", sortBy };
  }

  // Query supplier analysis
  if (/\b(proveedor|analiz[ae](r)?\s+proveedor|cuánto\s+compr[eé]\s+(?:a|de)|info\s+(de\s+)?proveedor|datos\s+(de\s+)?proveedor|ver\s+proveedor|ficha\s+(de\s+)?proveedor|historial\s+(de\s+)?proveedor)\b/.test(lower)) {
    const nameMatch = msg.match(/(?:proveedor|de|a|analiz[ae]r?\s+(?:al?\s+)?proveedor\s+)([A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]+(?:\s+[A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]+)?)/i);
    return { type: "query_supplier", supplierName: nameMatch?.[1]?.trim() };
  }

  // Create quote / presupuesto
  if (/\b(crea(r)?|hace(r)?|arma(r)?|genera(r)?|prepara(r)?|manda(r)?)\b.{0,30}\b(presupuesto|cotización|propuesta)\b/.test(lower) ||
      /\bpresupuesto\b.{0,20}\b(para|a|cliente)\b/.test(lower)) {
    const customerMatch = msg.match(/(?:para|a)\s+([A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]+(?:\s+[A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]+)?)/i);
    const productMatch = msg.match(/(?:de|por|incluye?|con)\s+([a-záéíóúüñA-ZÁÉÍÓÚÜÑ][^\d\n]{2,30}?)(?:\s+por|\s+a\s*\$|,|$)/i);
    const amountMatch = msg.match(/\$?\s*(\d[\d.,]*)/);
    return {
      type: "create_quote",
      customerName: customerMatch?.[1]?.trim(),
      productName: productMatch?.[1]?.trim(),
      amount: amountMatch?.[1]?.replace(/\./g, "").replace(",", "."),
    };
  }

  return null;
}

// ─── Action Card ──────────────────────────────────────────────────────────────
function ActionCard({ action, userId, onDone }: { action: AIAction; userId: string; onDone: () => void }) {
  const navigate = useNavigate();
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  // Create Product form
  const [pName, setPName] = useState(action.type === "create_product" ? (action.name || "") : "");
  const [pPrice, setPPrice] = useState(action.type === "create_product" ? (action.price || "") : "");
  const [pCategory, setPCategory] = useState(action.type === "create_product" ? (action.category || "") : "");
  const [pCost, setPCost] = useState("");

  // Create Expense form
  const [eDesc, setEDesc] = useState(action.type === "create_expense" ? (action.description || "") : "");
  const [eAmount, setEAmount] = useState(action.type === "create_expense" ? (action.amount || "") : "");
  const [eCategory, setECategory] = useState("otros");

  // Create Customer form
  const [cName, setCName] = useState(action.type === "create_customer" ? (action.name || "") : "");
  const [cPhone, setCPhone] = useState(action.type === "create_customer" ? (action.phone || "") : "");
  const [cEmail, setCEmail] = useState(action.type === "create_customer" ? (action.email || "") : "");

  if (done) {
    return (
      <div className="mt-2 flex items-center gap-2 text-xs text-emerald-400">
        <CheckCircle2 className="w-4 h-4" />Acción completada
      </div>
    );
  }

  if (action.type === "navigate") {
    return (
      <div className="mt-2">
        <Button size="sm" variant="outline" className="text-xs" onClick={() => { navigate(action.path); onDone(); }}>
          <Zap className="w-3.5 h-3.5 mr-1.5" />Ir a {action.label}
        </Button>
      </div>
    );
  }

  if (action.type === "create_product") {
    const handleCreate = async () => {
      if (!pName.trim() || !pPrice) return;
      setLoading(true);
      try {
        const orgId = requireActiveOrgId();
        await addProductDB({
          user_id: userId,
          org_id: orgId,
          name: pName.trim(),
          sale_price_ars: parseFloat(pPrice) || 0,
          cost_price_ars: parseFloat(pCost) || 0,
          category: pCategory.trim() || "General",
          stock: 0,
          brand: "",
          barcode: "",
          active: true,
        });
        toast.success(`Producto "${pName}" creado`);
        setDone(true);
        onDone();
      } catch (e: any) {
        toast.error(e.message || "Error creando producto");
      } finally {
        setLoading(false);
      }
    };
    return (
      <div className="mt-2 p-3 rounded-lg border border-primary/20 bg-primary/5 space-y-2">
        <p className="text-xs font-medium text-primary flex items-center gap-1.5">
          <Package className="w-3.5 h-3.5" />Crear producto
        </p>
        <Input value={pName} onChange={e => setPName(e.target.value)} placeholder="Nombre del producto *" className="h-7 text-xs" />
        <div className="flex gap-2">
          <Input value={pPrice} onChange={e => setPPrice(e.target.value)} placeholder="Precio venta *" className="h-7 text-xs" type="number" />
          <Input value={pCost} onChange={e => setPCost(e.target.value)} placeholder="Costo (opc.)" className="h-7 text-xs" type="number" />
        </div>
        <Input value={pCategory} onChange={e => setPCategory(e.target.value)} placeholder="Categoría (opc.)" className="h-7 text-xs" />
        <div className="flex gap-2">
          <Button size="sm" className="h-7 text-xs gradient-gold text-primary-foreground flex-1" disabled={!pName.trim() || !pPrice || loading} onClick={handleCreate}>
            {loading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Plus className="w-3 h-3 mr-1" />}Crear
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onDone}><X className="w-3 h-3" /></Button>
        </div>
      </div>
    );
  }

  if (action.type === "create_expense") {
    const handleCreate = async () => {
      if (!eDesc.trim() || !eAmount) return;
      setLoading(true);
      try {
        const orgId = requireActiveOrgId();
        await addExpenseDB({
          user_id: userId,
          org_id: orgId,
          description: eDesc.trim(),
          amount_ars: parseFloat(eAmount) || 0,
          category: eCategory,
          date: new Date().toISOString().slice(0, 10),
          payment_method: "efectivo",
        });
        toast.success("Gasto registrado");
        setDone(true);
        onDone();
      } catch (e: any) {
        toast.error(e.message || "Error registrando gasto");
      } finally {
        setLoading(false);
      }
    };
    return (
      <div className="mt-2 p-3 rounded-lg border border-yellow-500/20 bg-yellow-500/5 space-y-2">
        <p className="text-xs font-medium text-yellow-400 flex items-center gap-1.5">
          <TrendingDown className="w-3.5 h-3.5" />Registrar gasto
        </p>
        <Input value={eDesc} onChange={e => setEDesc(e.target.value)} placeholder="Descripción *" className="h-7 text-xs" />
        <div className="flex gap-2">
          <Input value={eAmount} onChange={e => setEAmount(e.target.value)} placeholder="Monto ARS *" className="h-7 text-xs" type="number" />
          <Select value={eCategory} onValueChange={setECategory}>
            <SelectTrigger className="h-7 flex-1 text-xs" aria-label="Categoría del gasto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
            {["alquiler","servicios","marketing","sueldos","logistica","impuestos","insumos","otros"].map(c => (
              <SelectItem key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</SelectItem>
            ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Button size="sm" className="h-7 text-xs bg-yellow-500 text-white flex-1" disabled={!eDesc.trim() || !eAmount || loading} onClick={handleCreate}>
            {loading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Plus className="w-3 h-3 mr-1" />}Guardar
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onDone}><X className="w-3 h-3" /></Button>
        </div>
      </div>
    );
  }

  if (action.type === "adjust_stock") {
    return <AdjustStockCard userId={userId} onDone={onDone} />;
  }

  if (action.type === "create_sale") {
    return <CreateSaleCard userId={userId} initialCustomer={action.customer} initialQty={action.quantity} onDone={onDone} />;
  }

  if (action.type === "create_purchase") {
    return <CreatePurchaseCard userId={userId} initialSupplier={action.supplier} initialQty={action.quantity} initialCostUSD={action.costUSD} onDone={onDone} />;
  }

  if (action.type === "query_debt") {
    return <QueryDebtCard userId={userId} initialName={action.customerName} onDone={onDone} />;
  }

  if (action.type === "query_stock") {
    return <QueryStockCard userId={userId} initialName={action.productName} onDone={onDone} />;
  }

  if (action.type === "query_restock") {
    return <RestockSuggestionCard userId={userId} onDone={onDone} />;
  }

  if (action.type === "create_task") {
    return <CreateTaskCard userId={userId} onDone={onDone} />;
  }

  if (action.type === "create_quote") {
    return <CreateQuoteCard userId={userId} initialCustomer={action.customerName} initialProduct={action.productName} initialAmount={action.amount} onDone={onDone} />;
  }

  if (action.type === "query_product_analysis") {
    return <QueryProductAnalysisCard userId={userId} initialName={action.productName} onDone={onDone} />;
  }

  if (action.type === "query_customer") {
    return <CustomerAnalysisCard userId={userId} initialName={action.customerName} onDone={onDone} />;
  }

  if (action.type === "query_sales_summary") {
    return <SalesSummaryCard userId={userId} initialPeriod={action.period} onDone={onDone} />;
  }

  if (action.type === "query_debts_summary") {
    return <DebtsSummaryCard userId={userId} onDone={onDone} />;
  }

  if (action.type === "query_top_products") {
    return <TopProductsCard userId={userId} initialSort={action.sortBy} onDone={onDone} />;
  }

  if (action.type === "query_expense_summary") {
    return <ExpenseSummaryCard userId={userId} initialPeriod={action.period} onDone={onDone} />;
  }

  if (action.type === "send_wa_segment") {
    return <SendWaSegmentCard initialSegment={action.segment} onDone={onDone} />;
  }

  if (action.type === "query_supplier") {
    return <SupplierAnalysisCard userId={userId} initialName={action.supplierName} onDone={onDone} />;
  }

  if (action.type === "create_customer") {
    const handleCreate = async () => {
      if (!cName.trim()) return;
      setLoading(true);
      try {
        await createCustomerDB(userId, {
          name: cName.trim(),
          phone: cPhone.trim() || undefined,
          email: cEmail.trim() || undefined,
        });
        toast.success(`Cliente "${cName}" creado`);
        setDone(true);
        onDone();
      } catch (e: any) {
        toast.error(e.message || "Error creando cliente");
      } finally {
        setLoading(false);
      }
    };
    return (
      <div className="mt-2 p-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 space-y-2">
        <p className="text-xs font-medium text-emerald-400 flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5" />Crear cliente
        </p>
        <Input value={cName} onChange={e => setCName(e.target.value)} placeholder="Nombre completo *" className="h-7 text-xs" />
        <div className="flex gap-2">
          <Input value={cPhone} onChange={e => setCPhone(e.target.value)} placeholder="Teléfono (opc.)" className="h-7 text-xs" />
          <Input value={cEmail} onChange={e => setCEmail(e.target.value)} placeholder="Email (opc.)" className="h-7 text-xs" />
        </div>
        <div className="flex gap-2">
          <Button size="sm" className="h-7 text-xs bg-emerald-500 text-white flex-1" disabled={!cName.trim() || loading} onClick={handleCreate}>
            {loading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Plus className="w-3 h-3 mr-1" />}Crear
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onDone}><X className="w-3 h-3" /></Button>
        </div>
      </div>
    );
  }

  return null;
}

function AdjustStockCard({ userId, onDone }: { userId: string; onDone: () => void }) {
  const [products, setProducts] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [newStock, setNewStock] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(true);

  useEffect(() => {
    getProductsDB(userId).then(p => { setProducts(p); setLoadingProducts(false); }).catch(() => setLoadingProducts(false));
  }, [userId]);

  if (done) {
    return (
      <div className="mt-2 flex items-center gap-2 text-xs text-emerald-400">
        <CheckCircle2 className="w-4 h-4" />Stock actualizado
      </div>
    );
  }

  const handleAdjust = async () => {
    if (!selectedId || newStock === "") return;
    setLoading(true);
    try {
      const desiredStock = parseInt(newStock, 10);
      if (isNaN(desiredStock) || desiredStock < 0) throw new Error("Cantidad de stock inválida");
      await setStockAbsoluteDB({
        productId: selectedId,
        newStock: desiredStock,
        userId,
        notes: "Ajuste de stock desde el asistente",
      });
      toast.success("Stock actualizado");
      setDone(true);
      onDone();
    } catch (e: any) {
      toast.error(e.message || "Error actualizando stock");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-2 p-3 rounded-lg border border-orange-500/20 bg-orange-500/5 space-y-2">
      <p className="text-xs font-medium text-orange-400 flex items-center gap-1.5">
        <Package className="w-3.5 h-3.5" />Ajustar stock
      </p>
      {loadingProducts ? (
        <p className="text-xs text-muted-foreground">Cargando productos...</p>
      ) : (
        <Select value={selectedId || "__none"} onValueChange={value => setSelectedId(value === "__none" ? "" : value)}>
          <SelectTrigger className="h-7 w-full text-xs" aria-label="Producto cuyo stock se ajustará">
            <SelectValue placeholder="Seleccioná un producto..." />
          </SelectTrigger>
          <SelectContent>
          <SelectItem value="__none">Seleccioná un producto...</SelectItem>
          {products.map(p => (
            <SelectItem key={p.id} value={p.id}>{p.name} (stock actual: {p.stock})</SelectItem>
          ))}
          </SelectContent>
        </Select>
      )}
      <Input
        value={newStock}
        onChange={e => setNewStock(e.target.value)}
        placeholder="Nuevo stock *"
        className="h-7 text-xs"
        type="number"
        min="0"
      />
      <div className="flex gap-2">
        <Button size="sm" className="h-7 text-xs bg-orange-500 text-white flex-1" disabled={!selectedId || newStock === "" || loading} onClick={handleAdjust}>
          {loading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Package className="w-3 h-3 mr-1" />}Actualizar
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onDone}><X className="w-3 h-3" /></Button>
      </div>
    </div>
  );
}

function CreateSaleCard({ userId, initialCustomer, initialQty, onDone }: {
  userId: string; initialCustomer?: string; initialQty?: string; onDone: () => void;
}) {
  const [products, setProducts] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [quantity, setQuantity] = useState(initialQty || "1");
  const [customer, setCustomer] = useState(initialCustomer || "");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(true);

  useEffect(() => {
    getProductsDB(userId).then(p => { setProducts(p.filter(x => x.is_active !== false)); setLoadingProducts(false); }).catch(() => setLoadingProducts(false));
  }, [userId]);

  if (done) {
    return (
      <div className="mt-2 flex items-center gap-2 text-xs text-emerald-400">
        <CheckCircle2 className="w-4 h-4" />Venta registrada
      </div>
    );
  }

  const selectedProduct = products.find(p => p.id === selectedId);
  const total = selectedProduct ? Number(selectedProduct.sale_price_ars) * parseInt(quantity || "1", 10) : 0;

  const handleCreate = async () => {
    if (!selectedId || !quantity) return;
    setLoading(true);
    try {
      const orgId = requireActiveOrgId();
      const qty = parseInt(quantity, 10);
      const prod = selectedProduct!;
      await addSaleDB({
        user_id: userId,
        org_id: orgId,
        product_id: prod.id,
        product_name: prod.name,
        quantity: qty,
        unit_price_ars: Number(prod.sale_price_ars),
        total_ars: Number(prod.sale_price_ars) * qty,
        cost_ars: Number(prod.cost_price_ars || 0) * qty,
        profit_ars: (Number(prod.sale_price_ars) - Number(prod.cost_price_ars || 0)) * qty,
        customer_name: customer.trim() || null,
        date: new Date().toISOString().slice(0, 10),
        payment_method: "efectivo",
        paid: true,
      });
      toast.success("Venta registrada");
      setDone(true);
      onDone();
    } catch (e: any) {
      toast.error(e.message || "Error registrando venta");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-2 p-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 space-y-2">
      <p className="text-xs font-medium text-emerald-400 flex items-center gap-1.5">
        <ShoppingCart className="w-3.5 h-3.5" />Registrar venta
      </p>
      {loadingProducts ? (
        <p className="text-xs text-muted-foreground">Cargando productos...</p>
      ) : (
        <Select value={selectedId || "__none"} onValueChange={value => setSelectedId(value === "__none" ? "" : value)}>
          <SelectTrigger className="h-7 w-full text-xs" aria-label="Producto de la venta">
            <SelectValue placeholder="Seleccioná un producto *" />
          </SelectTrigger>
          <SelectContent>
          <SelectItem value="__none">Seleccioná un producto *</SelectItem>
          {products.map(p => (
            <SelectItem key={p.id} value={p.id}>{p.name} — ${Number(p.sale_price_ars).toLocaleString('es-AR')}</SelectItem>
          ))}
          </SelectContent>
        </Select>
      )}
      <div className="flex gap-2">
        <Input value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="Cantidad *" className="h-7 text-xs w-20" type="number" min="1" />
        <Input value={customer} onChange={e => setCustomer(e.target.value)} placeholder="Cliente (opc.)" className="h-7 text-xs flex-1" />
      </div>
      {selectedProduct && (
        <p className="text-xs text-muted-foreground">Total: <span className="font-semibold text-emerald-400">${total.toLocaleString('es-AR')}</span></p>
      )}
      <div className="flex gap-2">
        <Button size="sm" className="h-7 text-xs bg-emerald-500 text-white flex-1" disabled={!selectedId || !quantity || loading} onClick={handleCreate}>
          {loading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <ShoppingCart className="w-3 h-3 mr-1" />}Registrar
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onDone}><X className="w-3 h-3" /></Button>
      </div>
    </div>
  );
}

function CreatePurchaseCard({ userId, initialSupplier, initialQty, initialCostUSD, onDone }: {
  userId: string; initialSupplier?: string; initialQty?: string; initialCostUSD?: string; onDone: () => void;
}) {
  const [products, setProducts] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [selectedId, setSelectedId] = useState("");
  const [quantity, setQuantity] = useState(initialQty || "1");
  const [supplier, setSupplier] = useState(initialSupplier || "");
  const [costUSD, setCostUSD] = useState(initialCostUSD || "");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    Promise.all([getProductsDB(userId), getSettingsDB(userId)]).then(([p, s]) => {
      setProducts(p.filter(x => x.is_active !== false));
      setSettings(s);
    }).catch(() => {});
  }, [userId]);

  if (done) {
    return (
      <div className="mt-2 flex items-center gap-2 text-xs text-primary">
        <CheckCircle2 className="w-4 h-4" />Compra registrada
      </div>
    );
  }

  const rate = (cotizacionDe(settings) ?? 0);
  const qty = parseInt(quantity || "1", 10);
  const unitCostUSD = parseFloat(costUSD || "0");
  const totalUSD = unitCostUSD * qty;
  const totalARS = totalUSD * rate;

  const handleCreate = async () => {
    if (!selectedId) return;
    setLoading(true);
    try {
      const orgId = requireActiveOrgId();
      const prod = products.find(p => p.id === selectedId)!;
      await addPurchaseDB({
        user_id: userId,
        org_id: orgId,
        product_id: prod.id,
        product_name: prod.name,
        quantity: qty,
        unit_cost_usd: unitCostUSD || Number(prod.cost_usd) || 0,
        customs_fee: Number(prod.customs_fee) || 0,
        total_usd: totalUSD || 0,
        total_ars: totalARS || 0,
        exchange_rate: rate,
        supplier: supplier.trim() || null,
        date: new Date().toISOString().slice(0, 10),
        is_scheduled: false,
      });
      toast.success("Compra registrada");
      setDone(true);
      onDone();
    } catch (e: any) {
      toast.error(e.message || "Error registrando compra");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-2 p-3 rounded-lg border border-primary/20 bg-primary/5 space-y-2">
      <p className="text-xs font-medium text-primary flex items-center gap-1.5">
        <Package className="w-3.5 h-3.5" />Registrar compra
      </p>
      <Select value={selectedId || "__none"} onValueChange={value => setSelectedId(value === "__none" ? "" : value)}>
        <SelectTrigger className="h-7 w-full text-xs" aria-label="Producto de la compra">
          <SelectValue placeholder="Seleccioná un producto *" />
        </SelectTrigger>
        <SelectContent>
        <SelectItem value="__none">Seleccioná un producto *</SelectItem>
        {products.map(p => (
          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
        ))}
        </SelectContent>
      </Select>
      <div className="flex gap-2">
        <Input value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="Cantidad *" className="h-7 text-xs w-20" type="number" min="1" />
        <Input value={costUSD} onChange={e => setCostUSD(e.target.value)} placeholder="Costo unit. USD" className="h-7 text-xs w-28" type="number" step="0.01" />
        <Input value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="Proveedor (opc.)" className="h-7 text-xs flex-1" />
      </div>
      {totalUSD > 0 && (
        <p className="text-xs text-muted-foreground">Total: <span className="font-semibold text-primary">USD {totalUSD.toFixed(2)}</span> · <span className="font-semibold">${totalARS.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span></p>
      )}
      <div className="flex gap-2">
        <Button size="sm" className="h-7 text-xs gradient-gold text-primary-foreground flex-1" disabled={!selectedId || loading} onClick={handleCreate}>
          {loading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Plus className="w-3 h-3 mr-1" />}Registrar
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onDone}><X className="w-3 h-3" /></Button>
      </div>
    </div>
  );
}

// ─── RestockSuggestionCard ────────────────────────────────────────────────────
function RestockSuggestionCard({ userId, onDone }: { userId: string; onDone: () => void }) {
  const { activeOrg } = useOrg();
  const [items, setItems] = useState<{ name: string; stock: number; category: string; unitsSold30: number; daysOfStock: number | null; urgency: 'high' | 'medium' | 'low' }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeOrg) return;
    (async () => {
      setLoading(true);
      try {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
        const [products, { data: recentSales }] = await Promise.all([
          getProductsDB(userId),
          supabase.from("sales").select("product_id, quantity").eq("org_id", activeOrg.id).gte("date", thirtyDaysAgo),
        ]);

        const salesMap: Record<string, number> = {};
        (recentSales || []).forEach((s: any) => {
          salesMap[s.product_id] = (salesMap[s.product_id] || 0) + Number(s.quantity);
        });

        const candidates = (products as any[])
          .filter(p => p.stock >= 0 && p.stock <= Math.max(5, (p.low_stock_threshold || 3)))
          .map(p => {
            const unitsSold30 = salesMap[p.id] || 0;
            const dailyRate = unitsSold30 / 30;
            const daysOfStock = dailyRate > 0 ? Math.floor(p.stock / dailyRate) : null;
            const urgency: 'high' | 'medium' | 'low' =
              p.stock === 0 ? 'high' :
              (daysOfStock !== null && daysOfStock <= 7) ? 'high' :
              (daysOfStock !== null && daysOfStock <= 14) ? 'medium' : 'low';
            return { name: p.name, stock: p.stock, category: p.category, unitsSold30, daysOfStock, urgency };
          })
          .sort((a, b) => {
            const urgOrder = { high: 0, medium: 1, low: 2 };
            if (urgOrder[a.urgency] !== urgOrder[b.urgency]) return urgOrder[a.urgency] - urgOrder[b.urgency];
            return b.unitsSold30 - a.unitsSold30;
          })
          .slice(0, 10);

        setItems(candidates);
      } catch { /* skip */ }
      setLoading(false);
    })();
  }, [userId, activeOrg]);

  const urgencyConfig = {
    high: { label: 'Urgente', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/30' },
    medium: { label: 'Pronto', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/30' },
    low: { label: 'Stock bajo', color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/30' },
  };

  return (
    <div className="rounded-xl border border-border bg-card/60 p-3 space-y-3 text-sm">
      <p className="text-xs font-semibold text-primary uppercase tracking-wider flex items-center gap-1.5">
        <Package className="w-3.5 h-3.5" />Sugerencia de restock
      </p>
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />Analizando inventario y ventas…
        </div>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">✅ Tu inventario está en buen estado. No hay productos críticos por ahora.</p>
      ) : (
        <div className="space-y-1.5">
          <p className="text-[10px] text-muted-foreground">{items.length} productos necesitan atención · basado en ventas últimos 30 días</p>
          {items.map((item, i) => {
            const cfg = urgencyConfig[item.urgency];
            return (
              <div key={i} className={`flex items-center justify-between rounded-lg border px-2.5 py-2 ${cfg.bg}`}>
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{item.name}</p>
                  <p className="text-[10px] text-muted-foreground">
                    Stock: <span className={item.stock === 0 ? 'text-red-400 font-bold' : 'font-medium'}>{item.stock} u.</span>
                    {item.unitsSold30 > 0 && ` · vendidos 30d: ${item.unitsSold30} u.`}
                    {item.daysOfStock !== null && ` · ~${item.daysOfStock}d de stock`}
                  </p>
                </div>
                <span className={`text-[10px] font-semibold shrink-0 ml-2 ${cfg.color}`}>{cfg.label}</span>
              </div>
            );
          })}
        </div>
      )}
      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onDone}><X className="w-3 h-3 mr-1" />Cerrar</Button>
    </div>
  );
}

// ─── QueryStockCard ───────────────────────────────────────────────────────────
function QueryStockCard({ userId, initialName, onDone }: { userId: string; initialName?: string; onDone: () => void }) {
  const [name, setName] = useState(initialName || "");
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const search = async () => {
    if (!name.trim()) return;
    setLoading(true);
    const products = await getProductsDB(userId);
    const found = products.filter((p: any) => p.name.toLowerCase().includes(name.toLowerCase().trim()));
    setResults(found);
    setSearched(true);
    setLoading(false);
  };

  useEffect(() => { if (initialName) search(); }, []);

  return (
    <div className="rounded-xl border border-border bg-card/60 p-3 space-y-3 text-sm">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Consultar stock</p>
      <div className="flex gap-2">
        <Input value={name} onChange={e => setName(e.target.value)} placeholder="Nombre del producto" className="h-8 text-sm bg-muted border-border flex-1" onKeyDown={e => e.key === "Enter" && search()} autoFocus={!initialName} />
        <Button size="sm" className="h-8" onClick={search} disabled={loading || !name.trim()}>
          {loading ? <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> : "Buscar"}
        </Button>
      </div>
      {searched && (
        results.length === 0
          ? <p className="text-xs text-muted-foreground">No encontré ningún producto que coincida con "{name}".</p>
          : <div className="space-y-1.5">
              {results.slice(0, 5).map((p: any) => (
                <div key={p.id} className="flex items-center justify-between py-1.5 px-2 rounded-lg bg-muted/30 border border-border/50">
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{p.name}</p>
                    {p.brand && <p className="text-[10px] text-muted-foreground">{p.brand}</p>}
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <span className={`text-sm font-bold ${p.stock <= 0 ? "text-red-400" : p.stock <= 3 ? "text-orange-400" : "text-green-400"}`}>{p.stock} u.</span>
                    {p.low_stock_threshold > 0 && <p className="text-[10px] text-muted-foreground">mín {p.low_stock_threshold}</p>}
                  </div>
                </div>
              ))}
              {results.length > 5 && <p className="text-[10px] text-muted-foreground">+{results.length - 5} más</p>}
            </div>
      )}
      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onDone}><X className="w-3 h-3 mr-1" />Cerrar</Button>
    </div>
  );
}

// ─── QueryDebtCard ────────────────────────────────────────────────────────────
function QueryDebtCard({ userId, initialName, onDone }: { userId: string; initialName?: string; onDone: () => void }) {
  const { activeOrg } = useOrg();
  const [name, setName] = useState(initialName || "");
  const [result, setResult] = useState<{ total: number; count: number; items: any[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const search = async () => {
    if (!name.trim() || !activeOrg) return;
    setLoading(true);
    const { data } = await supabase
      .from("debts")
      .select("id, customer_name, remaining_ars, due_date, status")
      .eq("org_id", activeOrg.id)
      .eq("status", "pending")
      .ilike("customer_name", `%${name.trim()}%`)
      .order("created_at", { ascending: false });
    const items = data || [];
    const total = items.reduce((s: number, d: any) => s + Number(d.remaining_ars), 0);
    setResult({ total, count: items.length, items });
    setSearched(true);
    setLoading(false);
  };

  useEffect(() => { if (initialName) search(); }, []);

  return (
    <div className="rounded-xl border border-border bg-card/60 p-3 space-y-3 text-sm">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Consultar deuda de cliente</p>
      <div className="flex gap-2">
        <Input value={name} onChange={e => setName(e.target.value)} placeholder="Nombre del cliente" className="h-8 text-sm bg-muted border-border flex-1" onKeyDown={e => e.key === "Enter" && search()} autoFocus={!initialName} />
        <Button size="sm" className="h-8" onClick={search} disabled={loading || !name.trim()}>
          {loading ? <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> : "Buscar"}
        </Button>
      </div>
      {searched && result && (
        result.count === 0
          ? <p className="text-xs text-muted-foreground">{name} no tiene deudas pendientes registradas.</p>
          : <div className="space-y-1.5">
              <p className="text-sm font-bold text-primary">{name}: {formatARS(result.total)} pendientes ({result.count} deuda{result.count !== 1 ? "s" : ""})</p>
              {result.items.slice(0, 5).map((d: any) => (
                <div key={d.id} className="flex justify-between text-xs text-muted-foreground border-t border-border/50 pt-1">
                  <span>{d.due_date ? `Vence ${new Date(d.due_date).toLocaleDateString("es-AR")}` : "Sin vencimiento"}</span>
                  <span className="font-semibold text-foreground">{formatARS(Number(d.remaining_ars))}</span>
                </div>
              ))}
              {result.items.length > 5 && <p className="text-[10px] text-muted-foreground">+{result.items.length - 5} más</p>}
            </div>
      )}
      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onDone}><X className="w-3 h-3 mr-1" />Cerrar</Button>
    </div>
  );
}

// ─── QueryProductAnalysisCard ─────────────────────────────────────────────────
function QueryProductAnalysisCard({ userId, initialName, onDone }: { userId: string; initialName?: string; onDone: () => void }) {
  const { activeOrg } = useOrg();
  const [name, setName] = useState(initialName || "");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const analyze = async () => {
    if (!name.trim() || !activeOrg) return;
    setLoading(true);
    try {
      const products = await getProductsDB(userId);
      const found = products.filter((p: any) => p.name.toLowerCase().includes(name.toLowerCase().trim()));
      if (!found.length) { setResult(null); setSearched(true); setLoading(false); return; }
      const prod = found[0];

      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);

      const { data: sales30 } = await supabase
        .from("sales")
        .select("quantity, total_ars, profit_ars, date, customer_name")
        .eq("org_id", activeOrg.id)
        .eq("product_id", prod.id)
        .gte("date", thirtyDaysAgo)
        .order("date", { ascending: false });

      const { data: sales60 } = await supabase
        .from("sales")
        .select("quantity, total_ars, profit_ars, date")
        .eq("org_id", activeOrg.id)
        .eq("product_id", prod.id)
        .gte("date", sixtyDaysAgo)
        .lt("date", thirtyDaysAgo);

      const s30 = sales30 || [];
      const s60 = sales60 || [];
      const units30 = s30.reduce((a: number, s: any) => a + Number(s.quantity), 0);
      const rev30 = s30.reduce((a: number, s: any) => a + Number(s.total_ars), 0);
      const profit30 = s30.reduce((a: number, s: any) => a + Number(s.profit_ars), 0);
      const units60prev = s60.reduce((a: number, s: any) => a + Number(s.quantity), 0);
      const margin30 = rev30 > 0 ? (profit30 / rev30) * 100 : 0;

      const lastSaleDate = s30.length > 0 ? s30[0].date : null;
      const daysSinceLastSale = lastSaleDate ? Math.floor((Date.now() - new Date(lastSaleDate).getTime()) / 86400000) : null;

      const unitGrowth = units60prev > 0 ? ((units30 - units60prev) / units60prev) * 100 : (units30 > 0 ? 100 : 0);

      setResult({ prod, units30, rev30, profit30, margin30, units60prev, unitGrowth, daysSinceLastSale, salesCount: s30.length });
    } catch { setResult(null); }
    setSearched(true);
    setLoading(false);
  };

  useEffect(() => { if (initialName) analyze(); }, []);

  return (
    <div className="rounded-xl border border-border bg-card/60 p-3 space-y-3 text-sm">
      <p className="text-xs font-semibold text-primary uppercase tracking-wider flex items-center gap-1.5">
        <BarChart2 className="w-3.5 h-3.5" />Análisis de producto
      </p>
      <div className="flex gap-2">
        <Input value={name} onChange={e => setName(e.target.value)} placeholder="Nombre del producto" className="h-8 text-sm bg-muted border-border flex-1" onKeyDown={e => e.key === "Enter" && analyze()} autoFocus={!initialName} />
        <Button size="sm" className="h-8" onClick={analyze} disabled={loading || !name.trim()}>
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Analizar"}
        </Button>
      </div>
      {searched && !result && <p className="text-xs text-muted-foreground">No encontré ningún producto con ese nombre.</p>}
      {searched && result && (() => {
        const { prod, units30, rev30, profit30, margin30, units60prev, unitGrowth, daysSinceLastSale, salesCount } = result;
        const trendIcon = unitGrowth > 10 ? "📈" : unitGrowth < -10 ? "📉" : "➡️";
        return (
          <div className="space-y-2 pb-12">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-base">{prod.name}</p>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${prod.stock <= 0 ? 'bg-red-500/15 text-red-400' : prod.stock <= 3 ? 'bg-orange-500/15 text-orange-400' : 'bg-green-500/15 text-green-400'}`}>
                Stock: {prod.stock} u.
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Unidades (30d)", value: `${units30} u.` },
                { label: "Facturado (30d)", value: `$${rev30.toLocaleString('es-AR', { maximumFractionDigits: 0 })}` },
                { label: "Ganancia (30d)", value: `$${profit30.toLocaleString('es-AR', { maximumFractionDigits: 0 })}` },
                { label: "Margen (30d)", value: `${margin30.toFixed(1)}%` },
              ].map(k => (
                <div key={k.label} className="bg-muted/40 rounded-lg px-2.5 py-2">
                  <p className="text-[10px] text-muted-foreground">{k.label}</p>
                  <p className="font-bold text-sm">{k.value}</p>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{trendIcon} vs 30d anteriores: <span className={`font-semibold ${unitGrowth >= 0 ? 'text-green-400' : 'text-red-400'}`}>{unitGrowth >= 0 ? '+' : ''}{unitGrowth.toFixed(0)}% unidades</span></span>
              {salesCount > 0 && <span>· {salesCount} transacciones</span>}
            </div>
            {daysSinceLastSale !== null && (
              <p className="text-xs text-muted-foreground">
                Última venta: hace <span className={`font-semibold ${daysSinceLastSale > 14 ? 'text-orange-400' : 'text-foreground'}`}>{daysSinceLastSale} días</span>
                {daysSinceLastSale === 0 && " (¡hoy!)"}
              </p>
            )}
            {units30 === 0 && <p className="text-xs text-orange-400 font-medium">⚠️ Sin ventas en los últimos 30 días</p>}
          </div>
        );
      })()}
      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onDone}><X className="w-3 h-3 mr-1" />Cerrar</Button>
    </div>
  );
}

// ─── CustomerAnalysisCard ─────────────────────────────────────────────────────
function CustomerAnalysisCard({ userId, initialName, onDone }: { userId: string; initialName?: string; onDone: () => void }) {
  const { activeOrg } = useOrg();
  const navigate = useNavigate();
  const [name, setName] = useState(initialName || "");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const analyze = async () => {
    if (!name.trim() || !activeOrg) return;
    setLoading(true);
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

      const [
        { data: customer },
        { data: allSales },
        { data: recentSales },
        { data: debts },
      ] = await Promise.all([
        supabase.from("customers").select("name, email, phone, company, created_at")
          .eq("org_id", activeOrg.id).ilike("name", `%${name.trim()}%`).limit(1).maybeSingle(),
        supabase.from("sales").select("total_ars, profit_ars, date, product_name, quantity")
          .eq("org_id", activeOrg.id).ilike("customer_name", `%${name.trim()}%`)
          .order("date", { ascending: false }).limit(100),
        supabase.from("sales").select("total_ars, product_name, quantity, date")
          .eq("org_id", activeOrg.id).ilike("customer_name", `%${name.trim()}%`)
          .gte("date", thirtyDaysAgo).order("date", { ascending: false }),
        supabase.from("debts").select("remaining_ars, status, due_date")
          .eq("org_id", activeOrg.id).ilike("customer_name", `%${name.trim()}%`)
          .eq("status", "pending"),
      ]);

      if (!allSales?.length && !customer) { setResult(null); setSearched(true); setLoading(false); return; }

      const totalSpent = (allSales || []).reduce((s: number, v: any) => s + Number(v.total_ars), 0);
      const totalProfit = (allSales || []).reduce((s: number, v: any) => s + Number(v.profit_ars), 0);
      const purchaseCount = (allSales || []).length;
      const avgTicket = purchaseCount > 0 ? totalSpent / purchaseCount : 0;
      const pendingDebt = (debts || []).reduce((s: number, d: any) => s + Number(d.remaining_ars), 0);
      const lastPurchaseDate = allSales?.[0]?.date;
      const daysSinceLast = lastPurchaseDate
        ? Math.floor((Date.now() - new Date(lastPurchaseDate).getTime()) / 86400000)
        : null;

      const rev30 = (recentSales || []).reduce((s: number, v: any) => s + Number(v.total_ars), 0);
      const units30 = (recentSales || []).reduce((s: number, v: any) => s + Number(v.quantity), 0);

      const displayName = customer?.name || name.trim();
      setResult({ customer, displayName, totalSpent, totalProfit, purchaseCount, avgTicket, pendingDebt, daysSinceLast, rev30, units30, recentSales: (allSales || []).slice(0, 5) });
    } catch { setResult(null); }
    setSearched(true);
    setLoading(false);
  };

  useEffect(() => { if (initialName) analyze(); }, []);

  const segColors: Record<string, string> = { VIP: 'text-yellow-400', Premium: 'text-purple-400', Frecuente: 'text-blue-400', Activo: 'text-green-400', 'En riesgo': 'text-orange-400', Dormido: 'text-orange-500', Perdido: 'text-red-400', Nuevo: 'text-cyan-400' };

  return (
    <div className="rounded-xl border border-border bg-card/60 p-3 space-y-3 text-sm">
      <p className="text-xs font-semibold text-primary uppercase tracking-wider flex items-center gap-1.5">
        <Users className="w-3.5 h-3.5" />Perfil de cliente
      </p>
      <div className="flex gap-2">
        <Input value={name} onChange={e => setName(e.target.value)} placeholder="Nombre del cliente" className="h-8 text-sm bg-muted border-border flex-1"
          onKeyDown={e => e.key === "Enter" && analyze()} autoFocus={!initialName} />
        <Button size="sm" className="h-8" onClick={analyze} disabled={loading || !name.trim()}>
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Buscar"}
        </Button>
      </div>
      {searched && !result && <p className="text-xs text-muted-foreground">No encontré ningún cliente con ese nombre.</p>}
      {searched && result && (() => {
        const { customer, displayName, totalSpent, totalProfit, purchaseCount, avgTicket, pendingDebt, daysSinceLast, rev30, units30, recentSales } = result;
        const seg = customer?.segment || "—";
        const segColor = segColors[seg] || "text-muted-foreground";
        const healthScore = customer?.health_score ?? null;
        return (
          <div className="space-y-2.5">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                <p className="font-bold text-base">{displayName}</p>
                {customer?.company && <p className="text-[11px] text-muted-foreground">🏢 {customer.company}</p>}
                {customer?.phone && <p className="text-[11px] text-muted-foreground">📞 {customer.phone}</p>}
              </div>
              <div className="text-right">
                <span className={`text-xs font-semibold ${segColor}`}>{seg}</span>
                {healthScore !== null && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">Score: {healthScore}/100</p>
                )}
              </div>
            </div>

            {/* KPIs */}
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { label: "Total facturado", value: formatARS(totalSpent), highlight: false },
                { label: "Ganancia generada", value: formatARS(totalProfit), highlight: false },
                { label: "Ticket promedio", value: formatARS(avgTicket), highlight: false },
                { label: "Deuda pendiente", value: formatARS(pendingDebt), highlight: pendingDebt > 0 },
              ].map(k => (
                <div key={k.label} className="bg-muted/40 rounded-lg px-2.5 py-2">
                  <p className="text-[10px] text-muted-foreground">{k.label}</p>
                  <p className={`font-bold text-sm ${k.highlight ? 'text-red-400' : ''}`}>{k.value}</p>
                </div>
              ))}
            </div>

            {/* Activity */}
            <div className="text-xs text-muted-foreground space-y-0.5">
              <p>🛒 <span className="font-medium">{purchaseCount}</span> compras totales</p>
              {rev30 > 0 && <p>📅 Últimos 30d: <span className="font-medium text-foreground">{formatARS(rev30)}</span> ({units30} u.)</p>}
              {daysSinceLast !== null && (
                <p>⏱ Última compra: hace <span className={`font-medium ${daysSinceLast > 30 ? 'text-orange-400' : 'text-foreground'}`}>{daysSinceLast}d</span>
                  {daysSinceLast === 0 && " 🔥 (¡hoy!)"}
                  {daysSinceLast > 60 && " ⚠️ en riesgo"}
                </p>
              )}
            </div>

            {/* Recent purchases */}
            {recentSales.length > 0 && (
              <div className="space-y-0.5">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Últimas compras</p>
                {recentSales.map((s: any, i: number) => (
                  <div key={i} className="flex justify-between text-xs border-t border-border/40 pt-1">
                    <span className="text-muted-foreground truncate max-w-[60%]">{s.product_name || "Venta"}</span>
                    <span className="font-medium">{formatARS(Number(s.total_ars))}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              {customer?.phone && (
                <a href={`https://wa.me/${customer.phone.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer">
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-green-500/30 text-green-400">
                    💬 WhatsApp
                  </Button>
                </a>
              )}
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => navigate("/clientes")}>
                Ver en CRM →
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs ml-auto" onClick={onDone}><X className="w-3 h-3" /></Button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ─── DebtsSummaryCard ────────────────────────────────────────────────────────
function DebtsSummaryCard({ userId, onDone }: { userId: string; onDone: () => void }) {
  const { activeOrg } = useOrg();
  const navigate = useNavigate();
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeOrg) return;
    (async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data } = await supabase
        .from("debts")
        .select("customer_name, remaining_ars, due_date, status")
        .eq("org_id", activeOrg.id)
        .eq("status", "pending");

      const debts = data || [];
      const total = debts.reduce((s: number, d: any) => s + Number(d.remaining_ars), 0);
      const overdue = debts.filter((d: any) => d.due_date && d.due_date < today);
      const overdueTotal = overdue.reduce((s: number, d: any) => s + Number(d.remaining_ars), 0);

      // Top debtors
      const byCustomer: Record<string, number> = {};
      for (const d of debts) byCustomer[d.customer_name] = (byCustomer[d.customer_name] || 0) + Number(d.remaining_ars);
      const topDebtors = Object.entries(byCustomer).sort((a, b) => b[1] - a[1]).slice(0, 5);

      setResult({ total, count: debts.length, overdueCount: overdue.length, overdueTotal, topDebtors });
      setLoading(false);
    })();
  }, [activeOrg]);

  return (
    <div className="rounded-xl border border-border bg-card/60 p-3 space-y-3 text-sm">
      <p className="text-xs font-semibold text-destructive uppercase tracking-wider flex items-center gap-1.5">
        <DollarSign className="w-3.5 h-3.5" />Cartera de cobros
      </p>
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />Consultando deudas…
        </div>
      ) : !result ? (
        <p className="text-xs text-muted-foreground">No se pudieron cargar los datos.</p>
      ) : result.count === 0 ? (
        <p className="text-xs text-green-400">✅ ¡Sin deudas pendientes! Todos los clientes al día.</p>
      ) : (
        <div className="space-y-2.5">
          <div className="grid grid-cols-2 gap-1.5">
            {[
              { label: "Total pendiente", value: formatARS(result.total), danger: false },
              { label: "Deudores", value: `${result.count} cliente${result.count !== 1 ? "s" : ""}`, danger: false },
              { label: "Vencidas", value: formatARS(result.overdueTotal), danger: result.overdueTotal > 0 },
              { label: "Cantidad vencidas", value: `${result.overdueCount} deuda${result.overdueCount !== 1 ? "s" : ""}`, danger: result.overdueCount > 0 },
            ].map(k => (
              <div key={k.label} className="bg-muted/40 rounded-lg px-2.5 py-2">
                <p className="text-[10px] text-muted-foreground">{k.label}</p>
                <p className={`font-bold text-sm ${k.danger ? "text-red-400" : ""}`}>{k.value}</p>
              </div>
            ))}
          </div>
          {result.topDebtors.length > 0 && (
            <div className="space-y-1 pb-12">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Top deudores</p>
              {result.topDebtors.map(([name, amount]: [string, number], i: number) => (
                <div key={i} className="flex items-center justify-between text-xs border-t border-border/40 pt-1">
                  <span className="text-muted-foreground truncate max-w-[60%]">{name}</span>
                  <span className="font-semibold text-red-400">{formatARS(amount)}</span>
                </div>
              ))}
            </div>
          )}
          <Button size="sm" variant="outline" className="h-7 text-xs w-full gap-1" onClick={() => { navigate("/deudas"); onDone(); }}>
            Ver todas las deudas →
          </Button>
        </div>
      )}
      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onDone}><X className="w-3 h-3 mr-1" />Cerrar</Button>
    </div>
  );
}

// ─── SalesSummaryCard ─────────────────────────────────────────────────────────
function SalesSummaryCard({ userId, initialPeriod, onDone }: {
  userId: string; initialPeriod?: "today" | "week" | "month"; onDone: () => void;
}) {
  const { activeOrg } = useOrg();
  const [period, setPeriod] = useState<"today" | "week" | "month">(initialPeriod || "today");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const load = async (p: "today" | "week" | "month") => {
    if (!activeOrg) return;
    setLoading(true);
    try {
      const now = new Date();
      let dateFrom: string;
      let prevFrom: string;
      let prevTo: string;
      if (p === "today") {
        dateFrom = now.toISOString().slice(0, 10);
        const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
        prevFrom = yesterday.toISOString().slice(0, 10);
        prevTo = yesterday.toISOString().slice(0, 10);
      } else if (p === "week") {
        const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - now.getDay());
        dateFrom = startOfWeek.toISOString().slice(0, 10);
        const prevWeekStart = new Date(startOfWeek); prevWeekStart.setDate(prevWeekStart.getDate() - 7);
        const prevWeekEnd = new Date(startOfWeek); prevWeekEnd.setDate(prevWeekEnd.getDate() - 1);
        prevFrom = prevWeekStart.toISOString().slice(0, 10);
        prevTo = prevWeekEnd.toISOString().slice(0, 10);
      } else {
        dateFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
        const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        prevFrom = prevMonth.toISOString().slice(0, 10);
        const lastDayPrev = new Date(now.getFullYear(), now.getMonth(), 0);
        prevTo = lastDayPrev.toISOString().slice(0, 10);
      }

      const [{ data: curr }, { data: prev }] = await Promise.all([
        supabase.from("sales").select("total_ars, profit_ars, product_name, quantity, payment_method")
          .eq("org_id", activeOrg.id).gte("date", dateFrom),
        supabase.from("sales").select("total_ars, profit_ars")
          .eq("org_id", activeOrg.id).gte("date", prevFrom).lte("date", prevTo),
      ]);

      const sales = curr || [];
      const revenue = sales.reduce((s: number, x: any) => s + Number(x.total_ars), 0);
      const profit = sales.reduce((s: number, x: any) => s + Number(x.profit_ars), 0);
      const count = sales.length;
      const avgTicket = count > 0 ? revenue / count : 0;
      const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

      // Top product by revenue
      const prodMap: Record<string, number> = {};
      for (const s of sales) prodMap[s.product_name || "—"] = (prodMap[s.product_name || "—"] || 0) + Number(s.total_ars);
      const topProduct = Object.entries(prodMap).sort((a, b) => b[1] - a[1])[0];

      // Payment method breakdown
      const methodMap: Record<string, number> = {};
      for (const s of sales) methodMap[s.payment_method || "efectivo"] = (methodMap[s.payment_method || "efectivo"] || 0) + Number(s.total_ars);

      const prevRevenue = (prev || []).reduce((s: number, x: any) => s + Number(x.total_ars), 0);
      const delta = prevRevenue > 0 ? ((revenue - prevRevenue) / prevRevenue) * 100 : null;

      setResult({ revenue, profit, count, avgTicket, margin, topProduct, methodMap, delta });
    } catch { setResult(null); }
    setLoading(false);
  };

  useEffect(() => { load(period); }, [period, activeOrg]);

  const periodLabel = { today: "Hoy", week: "Esta semana", month: "Este mes" };

  return (
    <div className="rounded-xl border border-border bg-card/60 p-3 space-y-3 text-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-primary uppercase tracking-wider flex items-center gap-1.5">
          <BarChart2 className="w-3.5 h-3.5" />Resumen de ventas
        </p>
        <div className="flex gap-1">
          {(["today", "week", "month"] as const).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`text-[10px] px-2 py-0.5 rounded-full font-medium transition-colors ${period === p ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {periodLabel[p]}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />Consultando ventas…
        </div>
      ) : !result ? (
        <p className="text-xs text-muted-foreground">No se pudieron cargar los datos.</p>
      ) : (
        <div className="space-y-2.5">
          {/* Main KPIs */}
          <div className="grid grid-cols-2 gap-1.5">
            {[
              { label: "Facturado", value: formatARS(result.revenue) },
              { label: "Ganancia", value: formatARS(result.profit) },
              { label: "Ventas", value: `${result.count} ticket${result.count !== 1 ? "s" : ""}` },
              { label: "Ticket promedio", value: formatARS(result.avgTicket) },
            ].map(k => (
              <div key={k.label} className="bg-muted/40 rounded-lg px-2.5 py-2">
                <p className="text-[10px] text-muted-foreground">{k.label}</p>
                <p className="font-bold text-sm">{k.value}</p>
              </div>
            ))}
          </div>

          {/* Margin + trend */}
          <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
            <span>📊 Margen: <span className={`font-semibold ${result.margin >= 30 ? "text-green-400" : result.margin >= 15 ? "text-amber-400" : "text-red-400"}`}>{result.margin.toFixed(1)}%</span></span>
            {result.delta !== null && (
              <span>vs anterior: <span className={`font-semibold ${result.delta >= 0 ? "text-green-400" : "text-red-400"}`}>{result.delta >= 0 ? "▲" : "▼"} {Math.abs(result.delta).toFixed(0)}%</span></span>
            )}
          </div>

          {/* Top product */}
          {result.topProduct && (
            <p className="text-xs">🏆 Más vendido: <span className="font-semibold text-foreground">{result.topProduct[0]}</span> <span className="text-muted-foreground">({formatARS(result.topProduct[1])})</span></p>
          )}

          {/* Payment methods */}
          {Object.keys(result.methodMap).length > 0 && (
            <div className="space-y-1 pb-12">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Por método de pago</p>
              {Object.entries(result.methodMap as Record<string, number>)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 4)
                .map(([method, total]) => (
                  <div key={method} className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full" style={{ width: `${(total / result.revenue) * 100}%` }} />
                    </div>
                    <span className="text-[10px] capitalize text-muted-foreground w-20 text-right">{method}</span>
                    <span className="text-[10px] font-medium w-16 text-right">{formatARS(total)}</span>
                  </div>
                ))
              }
            </div>
          )}
        </div>
      )}
      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onDone}><X className="w-3 h-3 mr-1" />Cerrar</Button>
    </div>
  );
}

// ─── SendWaSegmentCard ────────────────────────────────────────────────────────
function SendWaSegmentCard({ initialSegment, onDone }: { initialSegment?: string; onDone: () => void }) {
  const navigate = useNavigate();

  return (
    <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-3 space-y-3 text-sm">
      <p className="text-xs font-semibold text-green-400 uppercase tracking-wider flex items-center gap-1.5">
        <MessageSquare className="w-3.5 h-3.5" />Campaña WhatsApp
      </p>
      <p className="text-xs text-muted-foreground leading-relaxed">
        {initialSegment ? `Prepará una campaña para “${initialSegment}”` : "Prepará una campaña"} en el módulo de WhatsApp. Ahí se valida el consentimiento y la baja vigente justo antes del envío.
      </p>
      <div className="flex gap-2">
        <Button
          size="sm"
          className="h-7 text-xs bg-green-600 hover:bg-green-500 text-white flex-1 gap-1"
          onClick={() => { onDone(); navigate("/whatsapp-campaigns"); }}
        >
          <MessageSquare className="w-3 h-3" />Abrir campañas seguras
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onDone}><X className="w-3 h-3" /></Button>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const STARTER_QUESTIONS = [
  "¿Cuánto gané este mes?",
  "¿Qué producto tiene más margen?",
  "¿Cuáles son mis mejores clientes?",
  "¿Qué stock me está por quedar?",
  "¿Cómo va mi negocio comparado al mes pasado?",
  "¿Qué debería reponer urgente?",
];

// ─── CreateTaskCard ───────────────────────────────────────────────────────────
function CreateTaskCard({ userId, onDone }: { userId: string; onDone: () => void }) {
  const { activeOrg } = useOrg();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [priority, setPriority] = useState<"low" | "medium" | "high">("medium");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <div className="mt-2 flex items-center gap-2 text-xs text-emerald-400">
        <CheckCircle2 className="w-4 h-4" />Tarea creada correctamente
      </div>
    );
  }

  const handleCreate = async () => {
    if (!title.trim() || !activeOrg) return;
    setLoading(true);
    try {
      const { error } = await supabase.from("tasks").insert({
        org_id: activeOrg.id,
        user_id: userId,
        title: title.trim(),
        description: description.trim() || null,
        due_date: dueDate || null,
        priority,
        status: "pending",
      });
      if (error) throw error;
      toast.success(`Tarea "${title}" creada`);
      setDone(true);
      onDone();
    } catch (e: any) {
      toast.error(e.message || "Error creando tarea");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-2 p-3 rounded-lg border border-blue-500/20 bg-blue-500/5 space-y-2">
      <p className="text-xs font-medium text-blue-400 flex items-center gap-1.5">
        <ClipboardList className="w-3.5 h-3.5" />Nueva tarea
      </p>
      <Input
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="Título de la tarea *"
        className="h-7 text-xs"
        autoFocus
      />
      <Input
        value={description}
        onChange={e => setDescription(e.target.value)}
        placeholder="Descripción (opcional)"
        className="h-7 text-xs"
      />
      <div className="flex gap-2">
        <Input
          type="date"
          value={dueDate}
          onChange={e => setDueDate(e.target.value)}
          className="h-7 flex-1 px-2 text-xs"
          aria-label="Fecha límite de la tarea"
        />
        <Select value={priority} onValueChange={value => setPriority(value as "low" | "medium" | "high")}>
          <SelectTrigger className="h-7 w-[112px] text-xs" aria-label="Prioridad de la tarea">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="low">🟢 Baja</SelectItem>
            <SelectItem value="medium">🟡 Media</SelectItem>
            <SelectItem value="high">🔴 Alta</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex gap-2">
        <Button size="sm" className="h-7 text-xs bg-blue-600 hover:bg-blue-500 text-white flex-1" disabled={!title.trim() || loading} onClick={handleCreate}>
          {loading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Plus className="w-3 h-3 mr-1" />}Crear tarea
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onDone}><X className="w-3 h-3" /></Button>
      </div>
    </div>
  );
}

// ─── CreateQuoteCard ──────────────────────────────────────────────────────────
function CreateQuoteCard({ userId, initialCustomer, initialProduct, initialAmount, onDone }: {
  userId: string;
  initialCustomer?: string;
  initialProduct?: string;
  initialAmount?: string;
  onDone: () => void;
}) {
  const { activeOrg } = useOrg();
  const navigate = useNavigate();
  const [custName, setCustName] = useState(initialCustomer || "");
  const [custEmail, setCustEmail] = useState("");
  const [items, setItems] = useState([{
    description: initialProduct || "",
    qty: 1,
    unitPrice: initialAmount ? Number(initialAmount) : 0,
    total: initialAmount ? Number(initialAmount) : 0,
  }]);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [createdNumber, setCreatedNumber] = useState("");

  const updateItem = (i: number, field: string, val: string | number) => {
    setItems(prev => {
      const next = [...prev];
      (next[i] as Record<string, unknown>)[field] = val;
      next[i].total = Number(next[i].qty) * Number(next[i].unitPrice);
      return next;
    });
  };
  const total = items.reduce((s, it) => s + it.total, 0);

  if (done) {
    return (
      <div className="mt-2 p-3 rounded-lg border border-primary/20 bg-primary/5 space-y-2">
        <div className="flex items-center gap-2 text-xs text-emerald-400">
          <CheckCircle2 className="w-4 h-4" />
          <span>Presupuesto <span className="font-bold">{createdNumber}</span> creado</span>
        </div>
        <Button size="sm" className="h-7 text-xs" onClick={() => navigate("/presupuestos")}>
          Ver presupuestos →
        </Button>
      </div>
    );
  }

  const handleCreate = async () => {
    if (!custName.trim() || !activeOrg) return;
    if (items.every(it => !it.description.trim())) { toast.error("Agregá al menos un ítem"); return; }
    setLoading(true);
    try {
      const { data: numData } = await supabase.rpc("next_quote_number", { p_org_id: activeOrg.id });
      const quoteNumber = numData || `PRE-${Date.now()}`;
      const filteredItems = items.filter(it => it.description.trim());
      const subtotal = filteredItems.reduce((s, it) => s + it.total, 0);
      const { error } = await supabase.from("quotes").insert({
        org_id: activeOrg.id,
        quote_number: quoteNumber,
        customer_name: custName.trim(),
        customer_email: custEmail || null,
        items: filteredItems,
        subtotal,
        discount_amount: 0,
        total: subtotal,
        status: "draft",
        valid_until: (() => { const d = new Date(); d.setDate(d.getDate() + 15); return d.toISOString().slice(0, 10); })(),
        notes: notes || null,
        created_by: userId,
      });
      if (error) throw error;
      toast.success(`Presupuesto ${quoteNumber} creado`);
      setCreatedNumber(quoteNumber);
      setDone(true);
      onDone();
    } catch (e: any) {
      toast.error(e.message || "Error creando presupuesto");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-2 p-3 rounded-lg border border-primary/20 bg-primary/5 space-y-2">
      <p className="text-xs font-medium text-primary flex items-center gap-1.5">
        <DollarSign className="w-3.5 h-3.5" />Nuevo presupuesto
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Input value={custName} onChange={e => setCustName(e.target.value)} placeholder="Cliente *" className="h-7 text-xs" autoFocus />
        <Input value={custEmail} onChange={e => setCustEmail(e.target.value)} placeholder="Email (opcional)" className="h-7 text-xs" type="email" />
      </div>
      <div className="space-y-1 pb-12">
        <p className="text-[10px] text-muted-foreground font-medium">Ítems</p>
        {items.map((it, i) => (
          <div key={i} className="flex gap-1.5 items-center">
            <Input value={it.description} onChange={e => updateItem(i, "description", e.target.value)} placeholder="Producto / descripción…" className="flex-1 h-7 text-xs" />
            <Input type="number" value={it.qty} onChange={e => updateItem(i, "qty", Number(e.target.value))} className="w-10 h-7 text-xs text-center" min={1} />
            <Input type="number" value={it.unitPrice || ""} onChange={e => updateItem(i, "unitPrice", Number(e.target.value))} placeholder="Precio" className="w-20 h-7 text-xs" />
            {items.length > 1 && (
              <button className="text-muted-foreground hover:text-destructive" onClick={() => setItems(p => p.filter((_, j) => j !== i))}>
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}
        <button
          className="text-[10px] text-primary hover:underline flex items-center gap-1 mt-0.5"
          onClick={() => setItems(p => [...p, { description: "", qty: 1, unitPrice: 0, total: 0 }])}
        >
          <Plus className="w-3 h-3" />Agregar ítem
        </button>
      </div>
      {total > 0 && (
        <div className="text-right text-xs font-bold text-primary">
          Total: {new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(total)}
        </div>
      )}
      <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notas / condiciones (opcional)" className="h-7 text-xs" />
      <div className="flex gap-2">
        <Button size="sm" className="h-7 text-xs gradient-gold text-primary-foreground flex-1" disabled={!custName.trim() || loading} onClick={handleCreate}>
          {loading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Plus className="w-3 h-3 mr-1" />}Crear presupuesto
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onDone}><X className="w-3 h-3" /></Button>
      </div>
    </div>
  );
}

// ─── ExpenseSummaryCard ───────────────────────────────────────────────────────
function ExpenseSummaryCard({ userId, initialPeriod, onDone }: {
  userId: string; initialPeriod?: "month" | "week"; onDone: () => void;
}) {
  const { activeOrg } = useOrg();
  const navigate = useNavigate();
  const [period, setPeriod] = useState<"month" | "week">(initialPeriod || "month");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const load = async (p: "month" | "week") => {
    if (!activeOrg) return;
    setLoading(true);
    try {
      const now = new Date();
      let dateFrom: string;
      if (p === "week") {
        const d = new Date(now); d.setDate(now.getDate() - 6);
        dateFrom = d.toISOString().slice(0, 10);
      } else {
        dateFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
      }

      const { data } = await supabase.from("expenses")
        .select("amount_ars, category, description")
        .eq("org_id", activeOrg.id)
        .gte("date", dateFrom);

      const expenses = data || [];
      const total = expenses.reduce((s: number, e: any) => s + Number(e.amount_ars), 0);
      const byCat: Record<string, number> = {};
      const byMethod: Record<string, number> = {};
      expenses.forEach((e: any) => {
        byCat[e.category || "otros"] = (byCat[e.category || "otros"] || 0) + Number(e.amount_ars);
        byMethod[e.payment_method || "efectivo"] = (byMethod[e.payment_method || "efectivo"] || 0) + Number(e.amount_ars);
      });
      const topCats = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 5);
      const topMethod = Object.entries(byMethod).sort((a, b) => b[1] - a[1])[0];

      setResult({ total, count: expenses.length, topCats, topMethod, byCat });
    } finally { setLoading(false); }
  };

  useEffect(() => { load(period); }, [activeOrg, period]);

  const PERIOD_LABELS = { month: "Este mes", week: "Últimos 7 días" };
  const CAT_LABELS: Record<string, string> = {
    alquiler: "Alquiler", servicios: "Servicios", sueldos: "Sueldos",
    marketing: "Marketing", logistica: "Logística", impuestos: "Impuestos",
    mantenimiento: "Mantenimiento", otros: "Otros",
  };

  return (
    <div className="rounded-xl border border-border bg-card/60 p-3 space-y-3 text-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-yellow-400 uppercase tracking-wider flex items-center gap-1.5">
          <TrendingDown className="w-3.5 h-3.5" />Resumen de gastos
        </p>
        <div className="flex gap-1">
          {(["month", "week"] as const).map(p => (
            <button key={p}
              onClick={() => { setPeriod(p); load(p); }}
              className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${period === p ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/40" : "border-border text-muted-foreground hover:border-yellow-500/30"}`}
            >{PERIOD_LABELS[p]}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />Cargando gastos…
        </div>
      ) : !result || result.count === 0 ? (
        <p className="text-xs text-muted-foreground">Sin gastos en este período.</p>
      ) : (
        <div className="space-y-2.5">
          <div className="grid grid-cols-2 gap-1.5">
            <div className="bg-muted/40 rounded-lg px-2.5 py-2">
              <p className="text-[10px] text-muted-foreground">Total</p>
              <p className="font-bold text-sm text-yellow-400">{formatARS(result.total)}</p>
            </div>
            <div className="bg-muted/40 rounded-lg px-2.5 py-2">
              <p className="text-[10px] text-muted-foreground">Gastos</p>
              <p className="font-bold text-sm">{result.count}</p>
            </div>
            <div className="bg-muted/40 rounded-lg px-2.5 py-2">
              <p className="text-[10px] text-muted-foreground">Promedio</p>
              <p className="font-bold text-sm">{formatARS(result.total / result.count)}</p>
            </div>
            <div className="bg-muted/40 rounded-lg px-2.5 py-2">
              <p className="text-[10px] text-muted-foreground">Método principal</p>
              <p className="font-bold text-sm capitalize">{result.topMethod?.[0] || "—"}</p>
            </div>
          </div>

          {result.topCats.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Por categoría</p>
              {result.topCats.map(([cat, val]: [string, number]) => {
                const pct = result.total > 0 ? Math.round((val / result.total) * 100) : 0;
                return (
                  <div key={cat} className="space-y-0.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{CAT_LABELS[cat] || cat}</span>
                      <span className="font-semibold">{formatARS(val)} <span className="text-muted-foreground text-[10px]">({pct}%)</span></span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-yellow-500/60 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <Button size="sm" variant="outline" className="h-7 text-xs w-full gap-1" onClick={() => { navigate("/expenses"); onDone(); }}>
            Ver todos los gastos →
          </Button>
        </div>
      )}
      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onDone}><X className="w-3 h-3 mr-1" />Cerrar</Button>
    </div>
  );
}

// ─── TopProductsCard ──────────────────────────────────────────────────────────
function TopProductsCard({ userId, initialSort, onDone }: {
  userId: string; initialSort?: "revenue" | "profit" | "units"; onDone: () => void;
}) {
  const { activeOrg } = useOrg();
  const navigate = useNavigate();
  const [sortBy, setSortBy] = useState<"revenue" | "profit" | "units">(initialSort || "revenue");
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeOrg) return;
    setLoading(true);
    (async () => {
      const { data } = await supabase
        .from("sales")
        .select("product_name, total_ars, profit_ars, quantity")
        .eq("org_id", activeOrg.id);

      const sales = data || [];
      const map: Record<string, { name: string; revenue: number; profit: number; units: number }> = {};
      for (const s of sales) {
        const key = s.product_name || "Sin nombre";
        if (!map[key]) map[key] = { name: key, revenue: 0, profit: 0, units: 0 };
        map[key].revenue += Number(s.total_ars || 0);
        map[key].profit += Number(s.profit_ars || 0);
        map[key].units += Number(s.quantity || 1);
      }
      const list = Object.values(map).sort((a, b) => b[sortBy] - a[sortBy]).slice(0, 8);
      setProducts(list);
      setLoading(false);
    })();
  }, [activeOrg, sortBy]);

  const maxVal = products[0]?.[sortBy] || 1;
  const SORT_LABELS: Record<string, string> = { revenue: "Ingresos", profit: "Ganancia", units: "Unidades" };

  return (
    <div className="rounded-xl border border-border bg-card/60 p-3 space-y-3 text-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-primary uppercase tracking-wider flex items-center gap-1.5">
          <Package className="w-3.5 h-3.5" />Top productos
        </p>
        <div className="flex gap-1">
          {(["revenue", "profit", "units"] as const).map(s => (
            <button key={s}
              onClick={() => setSortBy(s)}
              className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${sortBy === s ? "bg-primary/20 text-primary border-primary/40" : "border-border text-muted-foreground hover:border-primary/30"}`}
            >{SORT_LABELS[s]}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />Cargando productos…
        </div>
      ) : products.length === 0 ? (
        <p className="text-xs text-muted-foreground">Sin datos de ventas aún.</p>
      ) : (
        <div className="space-y-2 pb-12">
          {products.map((p, i) => {
            const val = p[sortBy];
            const barW = Math.round((val / maxVal) * 100);
            const formatted = sortBy === "units" ? `${p.units} u.` : formatARS(val);
            return (
              <div key={p.name} className="space-y-0.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5">
                    <span className="text-[10px] text-muted-foreground font-mono w-4">{i + 1}.</span>
                    <span className="font-medium truncate max-w-[140px]">{p.name}</span>
                  </span>
                  <span className="font-bold text-primary shrink-0">{formatted}</span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-primary/70 rounded-full transition-all" style={{ width: `${barW}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="flex gap-2 pt-1">
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => { navigate("/analytics"); onDone(); }}>
          Ver analytics →
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onDone}><X className="w-3 h-3 mr-1" />Cerrar</Button>
      </div>
    </div>
  );
}

// ─── SupplierAnalysisCard ─────────────────────────────────────────────────────
function SupplierAnalysisCard({ userId, initialName, onDone }: {
  userId: string; initialName?: string; onDone: () => void;
}) {
  const { activeOrg } = useOrg();
  const navigate = useNavigate();
  const [search, setSearch] = useState(initialName || "");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [suppliers, setSuppliers] = useState<any[]>([]);

  useEffect(() => {
    if (!activeOrg) return;
    supabase.from("suppliers").select("id, name, phone, email, notes").eq("org_id", activeOrg.id)
      .then(({ data }) => setSuppliers(data || []));
  }, [activeOrg]);

  useEffect(() => {
    if (initialName && suppliers.length > 0) {
      const match = suppliers.find(s => s.name.toLowerCase().includes(initialName.toLowerCase()));
      if (match) analyzeSupplier(match);
    }
  }, [suppliers]);

  const analyzeSupplier = async (supplier: any) => {
    if (!activeOrg) return;
    setLoading(true);
    try {
      const { data: purchases } = await supabase
        .from("purchases")
        .select("id, created_at, total_usd, total_ars, quantity, product_name")
        .eq("org_id", activeOrg.id)
        .eq("supplier", supplier.name)
        .order("created_at", { ascending: false });

      const { data: debts } = await supabase
        .from("debts")
        .select("amount_ars, status")
        .eq("org_id", activeOrg.id)
        .eq("customer_name", supplier.name);

      const rows = purchases || [];
      const totalARS = rows.reduce((s: number, p: any) => s + Number(p.total_ars || 0), 0);
      const totalUSD = rows.reduce((s: number, p: any) => s + Number(p.total_usd || 0), 0);
      const count = rows.length;
      const lastPurchase = rows[0];
      const pending = (debts || []).filter((d: any) => d.status === "pendiente")
        .reduce((s: number, d: any) => s + Number(d.amount_ars || 0), 0);

      // top products by units
      const prodMap: Record<string, number> = {};
      rows.forEach((p: any) => {
        if (p.product_name) prodMap[p.product_name] = (prodMap[p.product_name] || 0) + Number(p.quantity || 1);
      });
      const topProds = Object.entries(prodMap).sort((a, b) => b[1] - a[1]).slice(0, 4);

      // monthly timeline (last 6 months)
      const monthly: Record<string, number> = {};
      rows.forEach((p: any) => {
        const key = (p.created_at || "").slice(0, 7);
        if (key) monthly[key] = (monthly[key] || 0) + Number(p.total_ars || 0);
      });
      const monthKeys = Object.keys(monthly).sort().slice(-6);

      setResult({ supplier, count, totalARS, totalUSD, pending, lastPurchase, topProds, monthly, monthKeys });
    } finally { setLoading(false); }
  };

  const filtered = suppliers.filter(s => s.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="rounded-xl border border-border bg-card/60 p-3 space-y-3 text-sm">
      <p className="text-xs font-semibold text-primary uppercase tracking-wider flex items-center gap-1.5">
        <Package className="w-3.5 h-3.5" />Análisis de proveedor
      </p>

      {!result ? (
        <div className="space-y-2 pb-12">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar proveedor…"
            className="w-full h-7 text-xs bg-muted border border-border rounded-md px-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          {filtered.length > 0 && (
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {filtered.slice(0, 8).map(s => (
                <button
                  key={s.id}
                  onClick={() => { setSearch(s.name); analyzeSupplier(s); }}
                  className="w-full text-left text-xs px-2.5 py-1.5 rounded-lg hover:bg-primary/10 transition-colors flex items-center gap-2"
                >
                  <Package className="w-3 h-3 text-muted-foreground shrink-0" />
                  <span className="font-medium">{s.name}</span>
                  {s.phone && <span className="text-muted-foreground text-[10px]">{s.phone}</span>}
                </button>
              ))}
            </div>
          )}
          {loading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />Analizando proveedor…
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3 pb-12">
          {/* Header */}
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-bold text-base leading-tight">{result.supplier.name}</p>
              {result.supplier.phone && <p className="text-[10px] text-muted-foreground">{result.supplier.phone}</p>}
              {result.supplier.email && <p className="text-[10px] text-muted-foreground">{result.supplier.email}</p>}
            </div>
            <button onClick={() => setResult(null)} className="text-[10px] text-muted-foreground hover:text-foreground">cambiar</button>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-2 gap-1.5">
            <div className="bg-muted/40 rounded-lg px-2.5 py-2">
              <p className="text-[10px] text-muted-foreground">Total comprado</p>
              <p className="font-bold text-sm text-primary">{formatARS(result.totalARS)}</p>
              {result.totalUSD > 0 && <p className="text-[10px] text-muted-foreground">USD {result.totalUSD.toLocaleString("es-AR")}</p>}
            </div>
            <div className="bg-muted/40 rounded-lg px-2.5 py-2">
              <p className="text-[10px] text-muted-foreground">Órdenes de compra</p>
              <p className="font-bold text-sm">{result.count}</p>
            </div>
            <div className="bg-muted/40 rounded-lg px-2.5 py-2">
              <p className="text-[10px] text-muted-foreground">Última compra</p>
              <p className="font-bold text-sm">{result.lastPurchase ? new Date(result.lastPurchase.created_at).toLocaleDateString("es-AR", { day: "numeric", month: "short" }) : "—"}</p>
            </div>
            <div className={`rounded-lg px-2.5 py-2 ${result.pending > 0 ? "bg-red-500/10" : "bg-muted/40"}`}>
              <p className="text-[10px] text-muted-foreground">Deuda pendiente</p>
              <p className={`font-bold text-sm ${result.pending > 0 ? "text-red-400" : "text-emerald-400"}`}>
                {result.pending > 0 ? formatARS(result.pending) : "Sin deuda"}
              </p>
            </div>
          </div>

          {/* Top products */}
          {result.topProds.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Productos más comprados</p>
              {result.topProds.map(([name, qty]: [string, number]) => (
                <div key={name} className="flex items-center justify-between text-xs gap-2">
                  <span className="truncate text-muted-foreground max-w-[160px]">{name}</span>
                  <span className="font-medium shrink-0">{qty} u.</span>
                </div>
              ))}
            </div>
          )}

          {/* Monthly timeline */}
          {result.monthKeys.length > 1 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Compras por mes</p>
              {result.monthKeys.map((k: string) => {
                const val = result.monthly[k] || 0;
                const max = Math.max(...result.monthKeys.map((mk: string) => result.monthly[mk] || 0));
                const pct = max > 0 ? Math.round((val / max) * 100) : 0;
                const label = new Date(k + "-01").toLocaleDateString("es-AR", { month: "short", year: "2-digit" });
                return (
                  <div key={k} className="space-y-0.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground capitalize">{label}</span>
                      <span className="font-medium">{formatARS(val)}</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary/60 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {result.supplier.notes && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-2.5 py-2">
              <p className="text-[10px] text-amber-400 font-medium mb-0.5">Notas</p>
              <p className="text-xs text-foreground/80">{result.supplier.notes}</p>
            </div>
          )}

          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1 flex-1" onClick={() => { navigate("/proveedores"); onDone(); }}>
              Ver proveedores →
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onDone}><X className="w-3 h-3" /></Button>
          </div>
        </div>
      )}
      {!result && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onDone}><X className="w-3 h-3 mr-1" />Cerrar</Button>}
    </div>
  );
}

const ACTION_STARTERS = [
  { label: "Registrar venta", icon: ShoppingCart, msg: "Registrar una venta" },
  { label: "Registrar compra", icon: Package, msg: "Registrar una compra" },
  { label: "Crear producto", icon: Package, msg: "Crear un producto nuevo" },
  { label: "Registrar gasto", icon: TrendingDown, msg: "Registrar un gasto" },
  { label: "Agregar cliente", icon: Users, msg: "Crear un cliente nuevo" },
  { label: "Ajustar stock", icon: Package, msg: "Ajustar stock de un producto" },
  { label: "Ver cliente", icon: Users, msg: "Perfil de cliente" },
  { label: "Consultar deuda", icon: DollarSign, msg: "¿Cuánto debe un cliente?" },
  { label: "Ver stock", icon: Package, msg: "¿Cuánto stock tengo de un producto?" },
  { label: "Analizar producto", icon: BarChart2, msg: "Analizá el producto" },
  { label: "Qué reponer", icon: TrendingDown, msg: "Qué productos debería reponer o comprar?" },
  { label: "Crear tarea", icon: ClipboardList, msg: "Crear una tarea o recordatorio" },
  { label: "Crear presupuesto", icon: DollarSign, msg: "Crear un presupuesto para un cliente" },
  { label: "Ventas de hoy", icon: BarChart2, msg: "Cómo me fue hoy con las ventas?" },
  { label: "WA por segmento", icon: MessageSquare, msg: "Mandá un WhatsApp a los clientes VIP" },
  { label: "Total deudas", icon: DollarSign, msg: "Resumen total de deudas pendientes" },
  { label: "Top productos", icon: Package, msg: "Cuáles son mis mejores productos?" },
  { label: "Gastos del mes", icon: TrendingDown, msg: "Cuánto gasté este mes? Resumen de gastos" },
  { label: "Ver proveedor", icon: Package, msg: "Info del proveedor" },
  { label: "📷 Foto producto", icon: Camera, msg: "Analizá esta imagen de un producto" },
];

const QUICK_ACTIONS = [
  { label: "Ir al POS", icon: ShoppingCart, path: "/pos" },
  { label: "Ver Inventario", icon: Package, path: "/products" },
  { label: "Ver Clientes", icon: Users, path: "/customers" },
  { label: "Ver Analytics", icon: BarChart2, path: "/analytics" },
  { label: "Ver Finanzas", icon: DollarSign, path: "/debts" },
  { label: "Ver Reportes", icon: Zap, path: "/reports" },
];

function formatMessage(text: string) {
  const lines = text.split("\n");
  return lines.map((line, i) => {
    if (line.startsWith("•") || line.startsWith("-") || line.startsWith("*")) {
      return <li key={i} className="ml-3">{line.replace(/^[•\-*]\s*/, "")}</li>;
    }
    if (line.trim() === "") return <br key={i} />;
    return <p key={i} className="mb-1">{line}</p>;
  });
}

// ─── Conversation history helpers ─────────────────────────────────────────────
type SavedConversation = {
  id: string;
  title: string;
  messages: ChatMessage[];
  savedAt: number;
};

const MAX_CONVERSATIONS = 10;

function getConvKey(orgId: string) { return `gestiona.ai_history.${orgId}`; }

function loadConversations(orgId: string): SavedConversation[] {
  try { return JSON.parse(localStorage.getItem(getConvKey(orgId)) || "[]"); } catch { return []; }
}

function saveConversations(orgId: string, convs: SavedConversation[]) {
  localStorage.setItem(getConvKey(orgId), JSON.stringify(convs.slice(0, MAX_CONVERSATIONS)));
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function AIChatAssistantTab() {
  const { user } = useAuth();
  const { activeOrg } = useOrg();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState(() => {
    const prefill = sessionStorage.getItem("gestiona.ai_prefill");
    if (prefill) { sessionStorage.removeItem("gestiona.ai_prefill"); return prefill; }
    return "";
  });
  const [loading, setLoading] = useState(false);
  const [dismissedActions, setDismissedActions] = useState<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null); // base64
  const [imageAnalyzing, setImageAnalyzing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [conversations, setConversations] = useState<SavedConversation[]>(() =>
    activeOrg ? loadConversations(activeOrg.id) : []
  );

  const [dailySuggestion, setDailySuggestion] = useState<string | null>(null);
  const [dailySuggestionDismissed, setDailySuggestionDismissed] = useState(false);

  // Reload conversation list when org changes
  useEffect(() => {
    if (activeOrg) setConversations(loadConversations(activeOrg.id));
  }, [activeOrg?.id]);

  // Daily suggestion: fire once per day — pull quick business stats and show a tip
  useEffect(() => {
    if (!user || !activeOrg) return;
    const dayKey = `gestiona.ai_daily_tip.${activeOrg.id}.${new Date().toISOString().slice(0, 10)}`;
    const cached = localStorage.getItem(dayKey);
    if (cached) { setDailySuggestion(cached); return; }

    (async () => {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const week = new Date(); week.setDate(week.getDate() - 7);
        const weekStr = week.toISOString().slice(0, 10);
        const [{ data: recentSales }, { data: lowStock }] = await Promise.all([
          supabase.from("sales").select("product_name,total_ars,date").eq("org_id", activeOrg.id).gte("date", weekStr).order("date", { ascending: false }).limit(30),
          supabase.from("products").select("name,stock,low_stock_threshold").eq("org_id", activeOrg.id).lte("stock", 3).gt("stock", 0).order("stock").limit(5),
        ]);

        const totalWeek = (recentSales || []).reduce((s: number, r: any) => s + Number(r.total_ars), 0);
        const topProds = Object.entries(
          (recentSales || []).reduce((m: Record<string, number>, r: any) => {
            const n = r.product_name || "—"; m[n] = (m[n] || 0) + Number(r.total_ars); return m;
          }, {})
        ).sort(([, a], [, b]) => b - a).slice(0, 2).map(([n]) => n);

        const tips = [
          totalWeek > 0 && `Esta semana vendiste ${formatARS(totalWeek)}${topProds.length ? ` · top: ${topProds.join(", ")}` : ""}`,
          (lowStock || []).length > 0 && `Stock crítico: ${(lowStock || []).map((p: any) => `${p.name} (${p.stock}u)`).join(", ")}`,
          "¿Querés que analice tus ventas de la semana y te dé sugerencias?",
        ].filter(Boolean);

        const suggestion = tips.join(" · ");
        localStorage.setItem(dayKey, suggestion);
        setDailySuggestion(suggestion);
      } catch { /* silently skip */ }
    })();
  }, [user, activeOrg]);

  const saveCurrentConversation = () => {
    if (!activeOrg || messages.length < 2) return;
    const firstUser = messages.find(m => m.role === "user")?.content || "Conversación";
    const title = firstUser.length > 60 ? firstUser.slice(0, 57) + "…" : firstUser;
    const conv: SavedConversation = { id: crypto.randomUUID(), title, messages, savedAt: Date.now() };
    const updated = [conv, ...conversations].slice(0, MAX_CONVERSATIONS);
    setConversations(updated);
    saveConversations(activeOrg.id, updated);
    toast.success("Conversación guardada");
  };

  const exportConversation = () => {
    if (messages.length === 0) return;
    const date = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const header = `Conversación con IA — ${activeOrg?.name || 'Gestiona'}\n${date}\n${'─'.repeat(60)}\n\n`;
    const body = messages.map(m => {
      const role = m.role === 'user' ? '👤 Usuario' : '🤖 Asistente IA';
      return `${role}:\n${m.content}\n`;
    }).join('\n' + '─'.repeat(40) + '\n\n');
    const text = header + body;
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `conversacion_ia_${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Conversación exportada');
  };

  const loadConversation = (conv: SavedConversation) => {
    setMessages(conv.messages);
    setDismissedActions(new Set());
    setShowHistory(false);
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  };

  const deleteConversation = (id: string) => {
    if (!activeOrg) return;
    const updated = conversations.filter(c => c.id !== id);
    setConversations(updated);
    saveConversations(activeOrg.id, updated);
  };

  const startNewConversation = () => {
    setMessages([]);
    setDismissedActions(new Set());
    setShowHistory(false);
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── AI Vision: analyze image ───────────────────────────────────────────────
  const analyzeImage = useCallback(async (base64: string, mimeType: string) => {
    if (!activeOrg) return;
    setImageAnalyzing(true);
    const aiMsgId = crypto.randomUUID();
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(), role: "user",
      content: "📷 [Imagen enviada para análisis]",
      ts: Date.now(),
    };
    setMessages(prev => [...prev, userMsg, { id: aiMsgId, role: "assistant", content: "", ts: Date.now(), streaming: true }]);
    setImagePreview(null);

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
      const { data: { session } } = await supabase.auth.getSession();

      const res = await fetch(`${supabaseUrl}/functions/v1/ai-chat`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${session?.access_token || anonKey}`,
          "apikey": anonKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: "Analizá esta imagen. Si es un producto: indicá nombre sugerido, categoría, precio estimado en ARS y descripción breve. Si es una factura o recibo: extraé proveedor, total, items y fecha. Si es otra cosa: describí qué ves y cómo puede ayudar al negocio.",
          history: [],
          orgId: activeOrg.id,
          image: { base64, mimeType },
        }),
      });

      if (!res.ok || !res.body) throw new Error(await motivoDeRespuesta(res, "No se pudo analizar la imagen"));

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n");
        buf = parts.pop() ?? "";
        for (const line of parts) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") break;
          try {
            const chunk = JSON.parse(raw);
            const delta = chunk.choices?.[0]?.delta?.content ?? chunk.delta?.text ?? "";
            if (delta) {
              accumulated += delta;
              setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, content: accumulated } : m));
            }
          } catch { /* ignore parse errors */ }
        }
      }
      setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, streaming: false, content: accumulated || "Análisis completado." } : m));
    } catch (e: any) {
      setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, streaming: false, content: `Error al analizar imagen: ${e.message}` } : m));
    } finally {
      setImageAnalyzing(false);
    }
  }, [activeOrg]);

  const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Solo se admiten imágenes"); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("La imagen debe ser menor a 5MB"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1];
      setImagePreview(result); // show preview
      analyzeImage(base64, file.type);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }, [analyzeImage]);

  const send = useCallback(async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || loading || !activeOrg) return;

    const detectedAction = detectIntent(msg);

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", content: msg, ts: Date.now() };
    const aiMsgId = crypto.randomUUID();
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    // Add empty streaming placeholder
    setMessages((prev) => [
      ...prev,
      { id: aiMsgId, role: "assistant", content: "", ts: Date.now(), streaming: true, action: detectedAction ?? undefined },
    ]);

    try {
      const history = messages.slice(-10).map((m) => ({ role: m.role, content: m.content }));

      // ── SSE streaming via raw fetch ───────────────────────────────────────
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
      const { data: { session } } = await supabase.auth.getSession();

      const res = await fetch(`${supabaseUrl}/functions/v1/ai-chat`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${session?.access_token || anonKey}`,
          "apikey": anonKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: msg, history, orgId: activeOrg.id }),
      });

      if (!res.ok || !res.body) {
        // El 402 de plan sin IA trae el motivo escrito adentro del JSON:
        // mostrarlo crudo sería darle al comercio un error de programa.
        throw new Error(await motivoDeRespuesta(res, "Error desconocido"));
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? ""; // keep incomplete line

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") break;
          try {
            const parsed = JSON.parse(raw) as { delta?: string; error?: string };
            if (parsed.error) throw new Error(parsed.error);
            if (parsed.delta) {
              accumulated += parsed.delta;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === aiMsgId ? { ...m, content: accumulated } : m
                )
              );
            }
          } catch {
            // ignore malformed lines
          }
        }
      }

      // Finalize — mark streaming done
      setMessages((prev) =>
        prev.map((m) =>
          m.id === aiMsgId ? { ...m, streaming: false } : m
        )
      );
    } catch (e: any) {
      toast.error(e.message || "No se pudo consultar el asistente");
      setMessages((prev) => prev.filter((m) => m.id !== userMsg.id && m.id !== aiMsgId));
      setInput(msg);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [input, loading, activeOrg, messages]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const dismissAction = (msgId: string) => {
    setDismissedActions(prev => new Set([...prev, msgId]));
  };

  const kpis = useMemo(() => {
    const totalMessages = messages.length;
    const userMessages = messages.filter(m => m.role === "user").length;
    const savedConvs = conversations.length;
    const activeActions = messages.filter(m => m.action && !dismissedActions.has(m.id)).length;
    return { totalMessages, userMessages, savedConvs, activeActions };
  }, [messages, conversations, dismissedActions]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm text-muted-foreground">Preguntá o pedí acciones en lenguaje natural</p>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowHistory(v => !v)} className={`text-muted-foreground ${showHistory ? "bg-muted" : ""}`}>
            <History className="w-3.5 h-3.5 mr-1.5" />Historial
          </Button>
          {messages.length >= 2 && (
            <Button variant="ghost" size="sm" onClick={saveCurrentConversation} className="text-muted-foreground">
              💾 Guardar
            </Button>
          )}
          {messages.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setMessages([])} className="text-muted-foreground">
              <Trash2 className="w-3.5 h-3.5 mr-1.5" />Limpiar
            </Button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="Mensajes" value={kpis.totalMessages} icon={MessageSquare} color="primary" sub="en esta sesión" />
        <KPICard label="Preguntas" value={kpis.userMessages} icon={Brain} color="blue" sub="enviadas por vos" />
        <KPICard label="Conversaciones" value={kpis.savedConvs} icon={History} color="success" sub="guardadas" />
        <KPICard label="Acciones activas" value={kpis.activeActions} icon={Zap} color="warning" sub="pendientes de ejecutar" />
      </div>

    <div className="flex gap-4 h-[calc(100vh-22rem)] relative">
      {/* History sidebar */}
      {showHistory && (
        <div className="w-72 shrink-0 flex flex-col bg-card border border-border/60 rounded-[10px] overflow-hidden">
          <div className="flex items-center justify-between px-3 py-3 border-b border-border">
            <h3 className="text-sm font-semibold flex items-center gap-1.5"><History className="w-4 h-4 text-primary" />Historial</h3>
            <button onClick={() => setShowHistory(false)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
          </div>
          <button onClick={startNewConversation}
            className="flex items-center gap-2 px-3 py-2.5 text-xs text-primary hover:bg-primary/10 border-b border-border transition-colors font-medium">
            <Plus className="w-3.5 h-3.5" />Nueva conversación
          </button>
          <div className="flex-1 overflow-y-auto">
            {conversations.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-xs px-3">
                <MessageSquare className="w-6 h-6 mx-auto mb-2 opacity-30" />
                Sin conversaciones guardadas.<br />Usá "Guardar" para conservar una.
              </div>
            ) : conversations.map(c => (
              <div key={c.id} className="group flex items-start gap-2 px-3 py-2.5 hover:bg-muted/30 cursor-pointer border-b border-border/40 transition-colors"
                onClick={() => loadConversation(c)}>
                <MessageSquare className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{c.title}</p>
                  <p className="text-[10px] text-muted-foreground">{new Date(c.savedAt).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                </div>
                <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 shrink-0 transition-all">
                  <button onClick={e => {
                    e.stopPropagation();
                    const date = new Date(c.savedAt).toLocaleDateString('es-AR');
                    const header = `${c.title}\n${date}\n${'─'.repeat(50)}\n\n`;
                    const body = c.messages.map(m => `${m.role === 'user' ? '👤 Usuario' : '🤖 IA'}:\n${m.content}\n`).join('\n──────────────────────────────────────\n\n');
                    const blob = new Blob([header + body], { type: 'text/plain;charset=utf-8' });
                    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `ia_${new Date(c.savedAt).toISOString().slice(0,10)}.txt`; a.click();
                  }} className="text-muted-foreground hover:text-primary" title="Exportar">
                    <Download className="w-3 h-3" />
                  </button>
                  <button onClick={e => { e.stopPropagation(); deleteConversation(c.id); }}
                    className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main chat */}
      <div className="flex flex-col flex-1 h-full min-w-0">

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-1 min-h-0">

        {/* Daily suggestion banner */}
        {dailySuggestion && !dailySuggestionDismissed && messages.length === 0 && (
          <div className="bg-primary/5 border border-primary/20 rounded-xl p-3 flex items-start gap-3 animate-in slide-in-from-top-2">
            <Sparkles className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold text-primary uppercase tracking-wide mb-1">Sugerencia del día</p>
              <p className="text-xs text-foreground leading-relaxed">{dailySuggestion}</p>
              <button
                onClick={() => send("Analizá mi situación actual y dame 3 sugerencias concretas para hoy basadas en mis ventas y stock.")}
                className="mt-2 text-xs text-primary hover:underline font-medium"
              >Analizar ahora →</button>
            </div>
            <button onClick={() => setDailySuggestionDismissed(true)} className="text-muted-foreground hover:text-foreground shrink-0">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center pb-8">
            <div className="w-16 h-16 rounded-[10px] bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
              <Sparkles className="w-8 h-8 text-primary" />
            </div>
            <h2 className="font-display font-bold text-lg mb-1">¿En qué puedo ayudarte?</h2>
            <p className="text-muted-foreground text-sm mb-5 max-w-sm">
              Consultá tus datos o pedime que realice acciones en tu negocio.
            </p>

            {/* Action starters */}
            <div className="w-full max-w-md mb-4">
              <p className="text-xs text-muted-foreground/60 uppercase tracking-wider text-center mb-2">Acciones directas</p>
              <div className="flex flex-wrap justify-center gap-2">
                {ACTION_STARTERS.map(a => (
                  <button
                    key={a.msg}
                    onClick={() => send(a.msg)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20 hover:border-primary/50 hover:bg-primary/20 transition-colors text-xs text-primary font-medium"
                  >
                    <a.icon className="w-3.5 h-3.5" />{a.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Starter questions */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-md">
              {STARTER_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => send(q)}
                  className="text-left text-sm px-3 py-2.5 rounded-lg bg-card border border-border hover:border-primary/40 hover:bg-primary/5 transition-colors text-muted-foreground hover:text-foreground"
                >
                  {q}
                </button>
              ))}
            </div>

            {/* Quick nav */}
            <div className="mt-5 w-full max-w-md">
              <p className="text-xs text-muted-foreground/60 uppercase tracking-wider text-center mb-2">Navegación rápida</p>
              <div className="flex flex-wrap justify-center gap-2">
                {QUICK_ACTIONS.map(a => (
                  <button key={a.path} onClick={() => navigate(a.path)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted border border-border hover:border-primary/40 hover:bg-primary/5 transition-colors text-xs text-muted-foreground hover:text-foreground">
                    <a.icon className="w-3.5 h-3.5" />{a.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
              msg.role === "user" ? "bg-primary/15" : "bg-card border border-border"
            }`}>
              {msg.role === "user"
                ? <User className="w-4 h-4 text-primary" />
                : <Bot className="w-4 h-4 text-primary" />}
            </div>
            <div className={`max-w-[85%] rounded-[10px] px-4 py-3 text-sm leading-relaxed ${
              msg.role === "user"
                ? "bg-primary/15 text-foreground rounded-tr-sm"
                : "bg-card/90 border border-border/50 rounded-[8px] rounded-tl-[2px]"
            }`}>
              {msg.role === "assistant"
                ? (
                  <>
                    <ul className="list-none space-y-0.5">{formatMessage(msg.content)}</ul>
                    {/* Blinking cursor while streaming */}
                    {msg.streaming && (
                      <span className="inline-block w-0.5 h-4 bg-primary/70 ml-0.5 animate-pulse align-middle" />
                    )}
                  </>
                )
                : msg.content}
              <span className="block mt-1.5 text-[10px] text-muted-foreground/60">
                {new Date(msg.ts).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
              </span>
              {/* Action card (only on assistant messages that have a detected action) */}
              {msg.role === "assistant" && msg.action && !dismissedActions.has(msg.id) && user && (
                <ActionCard
                  action={msg.action}
                  userId={user.id}
                  onDone={() => dismissAction(msg.id)}
                />
              )}
            </div>
          </div>
        ))}

        {/* Show bouncing dots only when loading but no streaming message exists yet */}
        {loading && !messages.some(m => m.streaming) && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-lg bg-card border border-border flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4 text-primary" />
            </div>
            <div className="bg-card/90 border border-border/50 rounded-[8px] rounded-tl-[2px] px-4 py-3">
              <div className="flex gap-1 items-center h-5">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="pt-4 shrink-0">
        {imagePreview && (
          <div className="mb-2 relative inline-block">
            <img src={imagePreview} alt="preview" className="h-16 w-auto rounded-lg border border-border object-cover" />
            <button onClick={() => setImagePreview(null)} className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-destructive text-white flex items-center justify-center text-[10px]">×</button>
          </div>
        )}
        <div className="flex gap-2 bg-card border border-border/60 rounded-[10px] p-2">
          <input ref={imageInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleImageSelect} />
          <button
            type="button"
            title="Analizar imagen con IA (producto, factura, recibo…)"
            onClick={() => imageInputRef.current?.click()}
            disabled={imageAnalyzing || loading}
            className="shrink-0 p-1.5 rounded-lg hover:bg-muted/40 text-muted-foreground hover:text-primary transition-colors disabled:opacity-40"
          >
            {imageAnalyzing ? <Loader2 className="w-4 h-4 animate-spin text-primary" /> : <Camera className="w-4 h-4" />}
          </button>
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Preguntá o pedí crear producto, registrar gasto, agregar cliente…"
            className="border-0 bg-transparent shadow-none focus-visible:ring-0 text-sm"
            disabled={loading}
          />
          <Button
            onClick={() => send()}
            disabled={!input.trim() || loading || !activeOrg}
            className="gradient-gold text-primary-foreground shrink-0"
            size="sm"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground/50 text-center mt-2">
          Los datos se actualizan en tiempo real · 📷 Mandá una foto de producto o factura para análisis con IA
        </p>
      </div>
      </div>{/* end main chat */}
    </div>{/* end flex chat viewport */}
    </div>
  );
}
