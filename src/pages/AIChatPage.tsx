import { useState, useRef, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import { useOrg } from "@/lib/orgContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Brain, Send, Loader2, Trash2, Bot, User, Sparkles, ShoppingCart,
  Package, Users, BarChart2, DollarSign, Zap, Plus, CheckCircle2, X,
  TrendingDown,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { addProductDB, addExpenseDB, createCustomerDB, getProductsDB, updateProductDB, addSaleDB } from "@/lib/supabaseStore";
import { requireActiveOrgId } from "@/lib/orgContext";

// ─── Types ────────────────────────────────────────────────────────────────────
type ActionType = "create_product" | "create_expense" | "create_customer" | "adjust_stock" | "navigate" | "create_sale";

type AIAction =
  | { type: "create_product"; name?: string; price?: string; category?: string }
  | { type: "create_expense"; description?: string; amount?: string; category?: string }
  | { type: "create_customer"; name?: string; phone?: string; email?: string }
  | { type: "adjust_stock"; productName?: string; quantity?: string }
  | { type: "create_sale"; productName?: string; quantity?: string; customer?: string }
  | { type: "navigate"; path: string; label: string };

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts: number;
  action?: AIAction;
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
      <div className="mt-2 flex items-center gap-2 text-xs text-success">
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
      <div className="mt-2 p-3 rounded-lg border border-warning/20 bg-warning/5 space-y-2">
        <p className="text-xs font-medium text-warning flex items-center gap-1.5">
          <TrendingDown className="w-3.5 h-3.5" />Registrar gasto
        </p>
        <Input value={eDesc} onChange={e => setEDesc(e.target.value)} placeholder="Descripción *" className="h-7 text-xs" />
        <div className="flex gap-2">
          <Input value={eAmount} onChange={e => setEAmount(e.target.value)} placeholder="Monto ARS *" className="h-7 text-xs" type="number" />
          <select
            value={eCategory}
            onChange={e => setECategory(e.target.value)}
            className="h-7 text-xs rounded-md border border-border bg-background px-2 flex-1"
          >
            {["alquiler","servicios","marketing","sueldos","logistica","impuestos","insumos","otros"].map(c => (
              <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <Button size="sm" className="h-7 text-xs bg-warning text-warning-foreground flex-1" disabled={!eDesc.trim() || !eAmount || loading} onClick={handleCreate}>
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
      <div className="mt-2 p-3 rounded-lg border border-success/20 bg-success/5 space-y-2">
        <p className="text-xs font-medium text-success flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5" />Crear cliente
        </p>
        <Input value={cName} onChange={e => setCName(e.target.value)} placeholder="Nombre completo *" className="h-7 text-xs" />
        <div className="flex gap-2">
          <Input value={cPhone} onChange={e => setCPhone(e.target.value)} placeholder="Teléfono (opc.)" className="h-7 text-xs" />
          <Input value={cEmail} onChange={e => setCEmail(e.target.value)} placeholder="Email (opc.)" className="h-7 text-xs" />
        </div>
        <div className="flex gap-2">
          <Button size="sm" className="h-7 text-xs bg-success text-success-foreground flex-1" disabled={!cName.trim() || loading} onClick={handleCreate}>
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
      <div className="mt-2 flex items-center gap-2 text-xs text-success">
        <CheckCircle2 className="w-4 h-4" />Stock actualizado
      </div>
    );
  }

  const handleAdjust = async () => {
    if (!selectedId || newStock === "") return;
    setLoading(true);
    try {
      await updateProductDB(selectedId, { stock: parseInt(newStock, 10) });
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
        <select
          value={selectedId}
          onChange={e => setSelectedId(e.target.value)}
          className="w-full h-7 text-xs rounded-md border border-border bg-background px-2"
        >
          <option value="">Seleccioná un producto...</option>
          {products.map(p => (
            <option key={p.id} value={p.id}>{p.name} (stock actual: {p.stock})</option>
          ))}
        </select>
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
    getProductsDB(userId).then(p => { setProducts(p.filter(x => x.active !== false)); setLoadingProducts(false); }).catch(() => setLoadingProducts(false));
  }, [userId]);

  if (done) {
    return (
      <div className="mt-2 flex items-center gap-2 text-xs text-success">
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
    <div className="mt-2 p-3 rounded-lg border border-success/20 bg-success/5 space-y-2">
      <p className="text-xs font-medium text-success flex items-center gap-1.5">
        <ShoppingCart className="w-3.5 h-3.5" />Registrar venta
      </p>
      {loadingProducts ? (
        <p className="text-xs text-muted-foreground">Cargando productos...</p>
      ) : (
        <select
          value={selectedId}
          onChange={e => setSelectedId(e.target.value)}
          className="w-full h-7 text-xs rounded-md border border-border bg-background px-2"
        >
          <option value="">Seleccioná un producto *</option>
          {products.map(p => (
            <option key={p.id} value={p.id}>{p.name} — ${Number(p.sale_price_ars).toLocaleString('es-AR')}</option>
          ))}
        </select>
      )}
      <div className="flex gap-2">
        <Input value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="Cantidad *" className="h-7 text-xs w-20" type="number" min="1" />
        <Input value={customer} onChange={e => setCustomer(e.target.value)} placeholder="Cliente (opc.)" className="h-7 text-xs flex-1" />
      </div>
      {selectedProduct && (
        <p className="text-xs text-muted-foreground">Total: <span className="font-semibold text-success">${total.toLocaleString('es-AR')}</span></p>
      )}
      <div className="flex gap-2">
        <Button size="sm" className="h-7 text-xs bg-success text-success-foreground flex-1" disabled={!selectedId || !quantity || loading} onClick={handleCreate}>
          {loading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <ShoppingCart className="w-3 h-3 mr-1" />}Registrar
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

const ACTION_STARTERS = [
  { label: "Registrar venta", icon: ShoppingCart, msg: "Registrar una venta" },
  { label: "Crear producto", icon: Package, msg: "Crear un producto nuevo" },
  { label: "Registrar gasto", icon: TrendingDown, msg: "Registrar un gasto" },
  { label: "Agregar cliente", icon: Users, msg: "Crear un cliente nuevo" },
  { label: "Ajustar stock", icon: Package, msg: "Ajustar stock de un producto" },
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

// ─── Main component ────────────────────────────────────────────────────────────
export default function AIChatPage() {
  const { user } = useAuth();
  const { activeOrg } = useOrg();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [dismissedActions, setDismissedActions] = useState<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = useCallback(async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || loading || !activeOrg) return;

    const detectedAction = detectIntent(msg);

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", content: msg, ts: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const history = messages.slice(-10).map((m) => ({ role: m.role, content: m.content }));
      const { data, error } = await supabase.functions.invoke("ai-chat", {
        body: { message: msg, history, orgId: activeOrg.id },
      });

      if (error || !data?.reply) throw new Error(data?.error || error?.message || "Error al consultar IA");

      const aiMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.reply,
        ts: Date.now(),
        action: detectedAction ?? undefined,
      };
      setMessages((prev) => [...prev, aiMsg]);
    } catch (e: any) {
      toast.error(e.message || "No se pudo consultar el asistente");
      setMessages((prev) => prev.filter((m) => m.id !== userMsg.id));
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

  return (
    <div className="flex flex-col h-[calc(100vh-5rem)] max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h1 className="text-2xl md:text-3xl font-display font-bold flex items-center gap-2">
            <Brain className="w-7 h-7 text-primary" />Asistente IA
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">Preguntá o pedí acciones en lenguaje natural</p>
        </div>
        {messages.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setMessages([])} className="text-muted-foreground">
            <Trash2 className="w-3.5 h-3.5 mr-1.5" />Limpiar
          </Button>
        )}
      </div>

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-1 min-h-0">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center pb-8">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
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
            <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
              msg.role === "user"
                ? "bg-primary/15 text-foreground rounded-tr-sm"
                : "bg-card border border-border rounded-tl-sm"
            }`}>
              {msg.role === "assistant"
                ? <ul className="list-none space-y-0.5">{formatMessage(msg.content)}</ul>
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

        {loading && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-lg bg-card border border-border flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4 text-primary" />
            </div>
            <div className="bg-card border border-border rounded-2xl rounded-tl-sm px-4 py-3">
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
        <div className="flex gap-2 bg-card border border-border rounded-xl p-2">
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
          Los datos se actualizan en tiempo real · Puede crear productos, gastos y clientes
        </p>
      </div>
    </div>
  );
}
