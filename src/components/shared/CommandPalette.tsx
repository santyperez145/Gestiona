import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LayoutDashboard, Package, ShoppingCart, DollarSign, AlertCircle, Settings, TrendingUp, Megaphone, Brain, Users, Crown, Gift, Wallet, Keyboard, Mail, MessageCircle, CreditCard } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getProductsDB } from "@/lib/supabaseStore";

const NAV_ITEMS = [
  { label: "Dashboard", path: "/", icon: LayoutDashboard, shortcut: "G H" },
  { label: "Productos", path: "/productos", icon: Package, shortcut: "Ctrl+P" },
  { label: "Compras", path: "/compras", icon: ShoppingCart },
  { label: "Ventas", path: "/ventas", icon: DollarSign, shortcut: "Ctrl+N" },
  { label: "Deudas", path: "/deudas", icon: AlertCircle, shortcut: "Ctrl+D" },
  { label: "Clientes / CRM", path: "/clientes", icon: Users },
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

const SHORTCUTS = [
  { keys: "Ctrl+K", desc: "Abrir buscador rápido" },
  { keys: "Ctrl+N", desc: "Nueva venta" },
  { keys: "Ctrl+P", desc: "Nuevo producto" },
  { keys: "Ctrl+G", desc: "Nuevo gasto" },
  { keys: "Ctrl+D", desc: "Ir a deudas" },
  { keys: "Ctrl+/", desc: "Ver atajos disponibles" },
];

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [products, setProducts] = useState<any[]>([]);
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "k") { e.preventDefault(); setOpen(o => !o); return; }
      if (mod && e.key === "/") { e.preventDefault(); setHelpOpen(true); return; }
      // Only navigation shortcuts when no input is focused
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (mod && e.key.toLowerCase() === "n") { e.preventDefault(); navigate("/ventas?new=1"); return; }
      if (mod && e.key.toLowerCase() === "p") { e.preventDefault(); navigate("/productos?new=1"); return; }
      if (mod && e.key.toLowerCase() === "g") { e.preventDefault(); navigate("/gastos?new=1"); return; }
      if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); navigate("/deudas"); return; }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [navigate]);

  useEffect(() => {
    if (open && user && products.length === 0) {
      getProductsDB(user.id).then(setProducts).catch(() => {});
    }
  }, [open, user]);

  const go = (path: string) => { navigate(path); setOpen(false); };

  return (
    <>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Buscar páginas, productos... (Ctrl+/ para atajos)" />
        <CommandList>
          <CommandEmpty>Sin resultados.</CommandEmpty>
          <CommandGroup heading="Páginas">
            {NAV_ITEMS.map(item => (
              <CommandItem key={item.path} onSelect={() => go(item.path)}>
                <item.icon className="mr-2 h-4 w-4 text-muted-foreground" />
                {item.label}
                {item.shortcut && <span className="ml-auto text-[10px] text-muted-foreground/60 font-mono">{item.shortcut}</span>}
              </CommandItem>
            ))}
          </CommandGroup>
          {products.length > 0 && (
            <CommandGroup heading="Productos">
              {products.slice(0, 10).map(p => (
                <CommandItem key={p.id} onSelect={() => go("/productos")}>
                  <Package className="mr-2 h-4 w-4 text-muted-foreground" />
                  {p.name}
                  <span className="ml-auto text-xs text-muted-foreground">Stock: {p.stock}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>

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
