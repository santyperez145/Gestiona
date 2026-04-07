import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { LayoutDashboard, Package, ShoppingCart, DollarSign, AlertCircle, Settings, TrendingUp, Megaphone, Brain, Users, Crown, Search } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getProductsDB } from "@/lib/supabaseStore";

const NAV_ITEMS = [
  { label: "Dashboard", path: "/", icon: LayoutDashboard },
  { label: "Productos", path: "/productos", icon: Package },
  { label: "Compras", path: "/compras", icon: ShoppingCart },
  { label: "Ventas", path: "/ventas", icon: DollarSign },
  { label: "Deudas", path: "/deudas", icon: AlertCircle },
  { label: "Clientes / CRM", path: "/clientes", icon: Users },
  { label: "Reportes", path: "/reportes", icon: TrendingUp },
  { label: "Marketing", path: "/marketing", icon: Megaphone },
  { label: "IA Insights", path: "/ia", icon: Brain },
  { label: "Ajustes", path: "/ajustes", icon: Settings },
  { label: "Admin", path: "/admin", icon: Crown },
];

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [products, setProducts] = useState<any[]>([]);
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(o => !o);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  useEffect(() => {
    if (open && user && products.length === 0) {
      getProductsDB(user.id).then(setProducts).catch(() => {});
    }
  }, [open, user]);

  const go = (path: string) => { navigate(path); setOpen(false); };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Buscar páginas, productos..." />
      <CommandList>
        <CommandEmpty>Sin resultados.</CommandEmpty>
        <CommandGroup heading="Páginas">
          {NAV_ITEMS.map(item => (
            <CommandItem key={item.path} onSelect={() => go(item.path)}>
              <item.icon className="mr-2 h-4 w-4 text-muted-foreground" />
              {item.label}
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
  );
}
