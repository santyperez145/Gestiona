/**
 * CommandPalette — Ctrl+K global search & action launcher.
 *
 * Features:
 *  - Fuse.js fuzzy search across products, customers, pages
 *  - Quick-action shortcuts (new sale, product, expense, quote, debt)
 *  - Recently visited pages (localStorage, last 5)
 *  - Stock badges with color coding (green/yellow/red)
 *  - Customer phone quick-dial links
 *  - Direct navigation on select
 */
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  LayoutDashboard, Package, ShoppingCart, DollarSign, AlertCircle, Settings,
  TrendingUp, Megaphone, Brain, Users, Crown, Gift, Wallet, Keyboard,
  Mail, MessageCircle, CreditCard, Plus, FileText, Receipt, User, History,
  Zap, Phone,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getProductsDB, getCustomersDB } from "@/lib/supabaseStore";
import Fuse from "fuse.js";

/* ─── Constants ─────────────────────────────────────────────────────────── */

const NAV_ITEMS = [
  { label: "Dashboard", path: "/", icon: LayoutDashboard, shortcut: "G H" },
  { label: "Productos", path: "/productos", icon: Package, shortcut: "Ctrl+P" },
  { label: "Punto de Venta (POS)", path: "/pos", icon: ShoppingCart },
  { label: "Ventas", path: "/ventas", icon: DollarSign, shortcut: "Ctrl+N" },
  { label: "Compras", path: "/compras", icon: ShoppingCart },
  { label: "Deudas", path: "/deudas", icon: AlertCircle, shortcut: "Ctrl+D" },
  { label: "Clientes / CRM", path: "/clientes", icon: Users },
  { label: "Presupuestos", path: "/presupuestos", icon: FileText },
  { label: "Gastos", path: "/gastos", icon: Wallet, shortcut: "Ctrl+G" },
  { label: "Reportes", path: "/reportes", icon: TrendingUp },
  { label: "Marketing", path: "/marketing", icon: Megaphone },
  { label: "Email Marketing", path: "/email-campaigns", icon: Mail },
  { label: "WhatsApp Masivo", path: "/whatsapp-campaigns", icon: MessageCircle },
  { label: "Links de Pago", path: "/links-de-pago", icon: CreditCard },
  { label: "Chat de Equipo", path: "/chat-equipo", icon: MessageCircle },
  { label: "Canjes & Influencers", path: "/canjes", icon: Gift },
  { label: "IA Insights", path: "/ia", icon: Brain },
  { label: "Ajustes", path: "/ajustes", icon: Settings },
  { label: "Admin", path: "/admin", icon: Crown },
];

const QUICK_ACTIONS = [
  { label: "Nueva venta rápida", path: "/ventas?new=1", icon: Plus, color: "text-green-400" },
  { label: "Nuevo presupuesto", path: "/presupuestos?new=1", icon: FileText, color: "text-blue-400" },
  { label: "Registrar gasto", path: "/gastos?new=1", icon: Receipt, color: "text-orange-400" },
  { label: "Nuevo producto", path: "/productos?new=1", icon: Package, color: "text-purple-400" },
  { label: "Nuevo cliente", path: "/clientes?new=1", icon: User, color: "text-cyan-400" },
  { label: "Registrar deuda", path: "/deudas?new=1", icon: AlertCircle, color: "text-red-400" },
  { label: "Chat con IA", path: "/ia", icon: Brain, color: "text-yellow-400" },
];

const SHORTCUTS = [
  { keys: "Ctrl+K", desc: "Abrir buscador rápido" },
  { keys: "Ctrl+N", desc: "Nueva venta" },
  { keys: "Ctrl+P", desc: "Nuevo producto" },
  { keys: "Ctrl+G", desc: "Nuevo gasto" },
  { keys: "Ctrl+D", desc: "Ir a deudas" },
  { keys: "Ctrl+/", desc: "Ver atajos disponibles" },
  { keys: "F2", desc: "Foco en búsqueda (POS)" },
  { keys: "F9", desc: "Confirmar venta (POS)" },
  { keys: "Esc", desc: "Limpiar / Cerrar" },
];

const RECENT_KEY = "cmd_palette_recent";
const MAX_RECENT = 5;

/* ─── Helpers ───────────────────────────────────────────────────────────── */

function stockColor(stock: number) {
  if (stock <= 0) return "bg-red-500/20 text-red-400";
  if (stock <= 5) return "bg-yellow-500/20 text-yellow-400";
  return "bg-green-500/20 text-green-400";
}

function getRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch { return []; }
}

function pushRecent(path: string) {
  try {
    const prev = getRecent().filter(p => p !== path);
    localStorage.setItem(RECENT_KEY, JSON.stringify([path, ...prev].slice(0, MAX_RECENT)));
  } catch { /* ignore */ }
}

/* ─── Component ─────────────────────────────────────────────────────────── */

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const loadedRef = useRef(false);
  const navigate = useNavigate();
  const { user } = useAuth();

  /* ── Global keyboard shortcuts ── */
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "k") { e.preventDefault(); setOpen(o => !o); return; }
      if (mod && e.key === "/") { e.preventDefault(); setHelpOpen(true); return; }
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (mod && e.key.toLowerCase() === "n") { e.preventDefault(); navigate("/ventas?new=1"); return; }
      if (mod && e.key.toLowerCase() === "p") { e.preventDefault(); navigate("/productos?new=1"); return; }
      if (mod && e.key.toLowerCase() === "g") { e.preventDefault(); navigate("/gastos?new=1"); return; }
      if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); navigate("/deudas"); return; }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [navigate]);

  /* ── Load data when palette opens (once per session) ── */
  useEffect(() => {
    if (!open || !user || loadedRef.current) return;
    loadedRef.current = true;
    setRecent(getRecent());
    Promise.all([
      getProductsDB(user.id).catch(() => []),
      getCustomersDB(user.id).catch(() => []),
    ]).then(([prods, custs]) => {
      setProducts(prods);
      setCustomers(custs);
    });
  }, [open, user]);

  /* ── Refresh recent on open ── */
  useEffect(() => {
    if (open) setRecent(getRecent());
  }, [open]);

  /* ── Fuse indexes ── */
  const productFuse = useMemo(() => new Fuse(products, {
    keys: [
      { name: "name", weight: 0.6 },
      { name: "category", weight: 0.2 },
      { name: "barcode", weight: 0.2 },
    ],
    threshold: 0.4,
    includeScore: true,
  }), [products]);

  const customerFuse = useMemo(() => new Fuse(customers, {
    keys: [
      { name: "name", weight: 0.6 },
      { name: "company", weight: 0.2 },
      { name: "phone", weight: 0.1 },
      { name: "email", weight: 0.1 },
    ],
    threshold: 0.4,
    includeScore: true,
  }), [customers]);

  const navFuse = useMemo(() => new Fuse(NAV_ITEMS, {
    keys: ["label"],
    threshold: 0.35,
    includeScore: true,
  }), []);

  /* ── Derived filtered results ── */
  const q = query.trim();

  const filteredNav = useMemo(() =>
    q ? navFuse.search(q).map(r => r.item) : NAV_ITEMS,
    [q, navFuse]
  );

  const filteredProducts = useMemo(() =>
    q ? productFuse.search(q).slice(0, 8).map(r => r.item) : products.slice(0, 6),
    [q, productFuse, products]
  );

  const filteredCustomers = useMemo(() =>
    q ? customerFuse.search(q).slice(0, 6).map(r => r.item) : customers.slice(0, 4),
    [q, customerFuse, customers]
  );

  const filteredActions = useMemo(() =>
    q ? QUICK_ACTIONS.filter(a => a.label.toLowerCase().includes(q.toLowerCase())) : QUICK_ACTIONS,
    [q]
  );

  /* ── Recent nav items ── */
  const recentNavItems = useMemo(() =>
    recent.map(path => NAV_ITEMS.find(n => n.path === path)).filter(Boolean) as typeof NAV_ITEMS,
    [recent]
  );

  /* ── Navigation helper ── */
  const go = useCallback((path: string) => {
    pushRecent(path);
    navigate(path);
    setOpen(false);
    setQuery("");
  }, [navigate]);

  const hasResults = filteredNav.length > 0 || filteredProducts.length > 0 || filteredCustomers.length > 0;

  return (
    <>
      <CommandDialog open={open} onOpenChange={v => { setOpen(v); if (!v) setQuery(""); }}>
        <CommandInput
          placeholder="Buscar páginas, productos, clientes... (Ctrl+/ atajos)"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>
            {q ? `Sin resultados para "${q}"` : "Escribe para buscar..."}
          </CommandEmpty>

          {/* ── Quick actions ── */}
          {filteredActions.length > 0 && (
            <CommandGroup heading="Acciones rápidas">
              {filteredActions.map(action => (
                <CommandItem key={action.path} onSelect={() => go(action.path)} className="gap-2">
                  <action.icon className={`h-4 w-4 shrink-0 ${action.color}`} />
                  <span>{action.label}</span>
                  <Zap className="ml-auto h-3 w-3 text-yellow-500/60" />
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {/* ── Recent (only when no query) ── */}
          {!q && recentNavItems.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Visitado recientemente">
                {recentNavItems.map(item => (
                  <CommandItem key={item.path} onSelect={() => go(item.path)} className="gap-2">
                    <History className="h-4 w-4 shrink-0 text-muted-foreground/60" />
                    <item.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span>{item.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}

          {/* ── Products ── */}
          {filteredProducts.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading={q ? `Productos — "${q}"` : "Productos"}>
                {filteredProducts.map(p => (
                  <CommandItem
                    key={p.id}
                    onSelect={() => go(`/productos?highlight=${p.id}`)}
                    className="gap-2"
                  >
                    <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate">{p.name}</span>
                    {p.category && (
                      <span className="text-[10px] text-muted-foreground/60 hidden sm:inline">{p.category}</span>
                    )}
                    <Badge
                      variant="outline"
                      className={`text-[10px] px-1.5 py-0 border-0 ${stockColor(Number(p.stock ?? 0))}`}
                    >
                      {Number(p.stock ?? 0)} uds
                    </Badge>
                    {p.price_sale != null && (
                      <span className="text-xs text-muted-foreground font-mono">
                        ${Number(p.price_sale).toLocaleString("es-AR")}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}

          {/* ── Customers ── */}
          {filteredCustomers.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading={q ? `Clientes — "${q}"` : "Clientes"}>
                {filteredCustomers.map(c => (
                  <CommandItem
                    key={c.id}
                    onSelect={() => go(`/clientes?id=${c.id}`)}
                    className="gap-2"
                  >
                    <User className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate">{c.name}</span>
                    {c.company && (
                      <span className="text-[10px] text-muted-foreground/60 hidden sm:inline truncate max-w-[100px]">{c.company}</span>
                    )}
                    {c.phone && (
                      <a
                        href={`https://wa.me/${c.phone.replace(/\D/g, "")}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="text-green-400 hover:text-green-300"
                        title={`WhatsApp: ${c.phone}`}
                      >
                        <Phone className="h-3 w-3" />
                      </a>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}

          {/* ── Navigation ── */}
          {filteredNav.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Páginas">
                {filteredNav.map(item => (
                  <CommandItem key={item.path} onSelect={() => go(item.path)} className="gap-2">
                    <item.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span>{item.label}</span>
                    {item.shortcut && (
                      <kbd className="ml-auto text-[10px] font-mono text-muted-foreground/50 bg-muted/50 border border-border/40 rounded px-1.5">
                        {item.shortcut}
                      </kbd>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
        </CommandList>

        {/* ── Footer ── */}
        <div className="flex items-center justify-between px-3 py-2 border-t border-border/40 text-[10px] text-muted-foreground/50">
          <span>↑↓ navegar · Enter seleccionar · Esc cerrar</span>
          <button onClick={() => { setOpen(false); setHelpOpen(true); }} className="hover:text-muted-foreground transition-colors">
            Ctrl+/ ver atajos
          </button>
        </div>
      </CommandDialog>

      {/* ── Keyboard shortcuts help ── */}
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="bg-[hsl(228_24%_7%)] border-border/60 max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <Keyboard className="w-5 h-5 text-primary" /> Atajos de teclado
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {SHORTCUTS.map(s => (
              <div key={s.keys} className="flex items-center justify-between p-2.5 bg-muted/50 rounded-lg">
                <span className="text-sm text-muted-foreground">{s.desc}</span>
                <kbd className="px-2 py-1 text-[11px] font-mono bg-[hsl(228_24%_7%)] border border-border/60 rounded">{s.keys}</kbd>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
