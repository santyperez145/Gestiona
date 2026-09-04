import { useEffect, useMemo, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/storefront/storeContext";
import StoreHome from "@/storefront/StoreHome";

function relativeStorePath(pathname: string, basePath: string): string {
  const relative = basePath && pathname.startsWith(basePath)
    ? pathname.slice(basePath.length)
    : pathname;
  try {
    return decodeURIComponent(relative || "/");
  } catch {
    return relative || "/";
  }
}

export default function StoreLegacyRedirect({ disabled = false }: { disabled?: boolean }) {
  const { pathname } = useLocation();
  const { store, basePath } = useStore();
  const sourcePath = useMemo(
    () => relativeStorePath(pathname, basePath).replace(/\/+$/, "") || "/",
    [basePath, pathname],
  );
  const [destination, setDestination] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    setDestination(undefined);
    if (disabled || !store?.slug || sourcePath === "/") {
      setDestination(null);
      return () => { active = false; };
    }
    void supabase.rpc("resolve_store_url_redirect", {
      p_slug: store.slug,
      p_path: sourcePath,
    }).then(({ data, error }) => {
      if (!active) return;
      if (error) {
        console.error("No se pudo resolver la URL heredada de la tienda", error);
        setDestination(null);
        return;
      }
      const resolved = typeof data === "string" && data.startsWith("/") && !data.startsWith("//")
        ? data
        : null;
      setDestination(resolved);
    });
    return () => { active = false; };
  }, [disabled, sourcePath, store?.slug]);

  if (destination === undefined) return null;
  if (destination) return <Navigate to={`${basePath}${destination}`} replace />;
  return <StoreHome />;
}
