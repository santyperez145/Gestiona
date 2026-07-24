import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";

// ── Light/dark toggle — mounted once in AppLayout's sidebar footer ──────────
export default function ThemeToggle({ collapsed = false }: { collapsed?: boolean }) {
  const { resolvedTheme, setTheme } = useTheme();
  // Avoid a hydration/first-paint mismatch: only trust resolvedTheme once mounted.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = !mounted || resolvedTheme !== "light";

  return (
    <Button
      type="button"
      variant="ghost"
      size={collapsed ? "icon" : "sm"}
      className={collapsed ? "w-full" : "w-full justify-start gap-2 text-muted-foreground"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      title={isDark ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
      aria-label={isDark ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
    >
      {isDark ? <Sun className="h-4 w-4 shrink-0" /> : <Moon className="h-4 w-4 shrink-0" />}
      {!collapsed && <span className="text-xs">{isDark ? "Tema claro" : "Tema oscuro"}</span>}
    </Button>
  );
}
