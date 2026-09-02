/**
 * Sesión del comprador dentro de una tienda.
 *
 * Se apoya en Supabase Auth, pero el vínculo con la tienda vive en
 * `store_customers`: la misma persona puede tener cuenta en varias tiendas del
 * SaaS sin que se mezclen sus datos.
 *
 * Importante: tener cuenta de comprador NO da acceso al panel de gestión. Eso
 * lo decide `memberships`, que estos usuarios no tienen.
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";

export interface StoreCustomer {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  default_address: Record<string, string>;
}

interface Ctx {
  loading: boolean;
  session: Session | null;
  customer: StoreCustomer | null;
  signUp: (email: string, password: string, name: string) => Promise<{ error?: string; needsConfirm?: boolean }>;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  /** Magic link / código. shouldCreateUser true + account_type store_customer. */
  signInWithEmailOtp: (email: string, opts?: { createUser?: boolean; name?: string }) => Promise<{ error?: string }>;
  verifyEmailOtp: (email: string, token: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error?: string }>;
  refresh: () => Promise<void>;
}

const StoreAuthContext = createContext<Ctx | null>(null);

function storeAccountRedirect(slug: string): string {
  return `${window.location.origin}/tienda/${slug}/cuenta`;
}

export function StoreAuthProvider({ slug, children }: { slug: string; children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [customer, setCustomer] = useState<StoreCustomer | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data: { session: s } } = await supabase.auth.getSession();
    setSession(s);
    if (!s) { setCustomer(null); setLoading(false); return; }

    try {
      await supabase.rpc("upsert_store_customer", { p_slug: slug, p_name: null, p_phone: null });
      const { data } = await supabase
        .from("store_customers")
        .select("id, email, name, phone, default_address")
        .eq("user_id", s.user.id)
        .limit(1);
      const row = data?.[0];
      setCustomer(row ? { ...row, default_address: (row.default_address ?? {}) as Record<string, string> } : null);
    } catch {
      setCustomer(null);
    }
    setLoading(false);
  }, [slug]);

  useEffect(() => {
    refresh();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (!s) setCustomer(null);
      else refresh();
    });
    return () => sub.subscription.unsubscribe();
  }, [refresh]);

  const value = useMemo<Ctx>(() => ({
    loading, session, customer,

    signUp: async (email, password, name) => {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          // `account_type` evita que el trigger de Supabase le cree una
          // organización y un trial: es un comprador, no un usuario del SaaS.
          data: { full_name: name, account_type: "store_customer", store_slug: slug },
          emailRedirectTo: storeAccountRedirect(slug),
        },
      });
      if (error) return { error: error.message };
      // Sin sesión inmediata = falta confirmar el email.
      if (!data.session) return { needsConfirm: true };
      await supabase.rpc("upsert_store_customer", { p_slug: slug, p_name: name, p_phone: null });
      await refresh();
      return {};
    },

    signIn: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        return {
          error: error.message.includes("Invalid login")
            ? "Email o contraseña incorrectos"
            : error.message,
        };
      }
      await refresh();
      return {};
    },

    signInWithEmailOtp: async (email, opts = {}) => {
      const createUser = opts.createUser === true;
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          shouldCreateUser: createUser,
          emailRedirectTo: storeAccountRedirect(slug),
          data: createUser
            ? {
                full_name: opts.name?.trim() || undefined,
                account_type: "store_customer",
                store_slug: slug,
              }
            : undefined,
        },
      });
      return error ? { error: error.message } : {};
    },

    verifyEmailOtp: async (email, token) => {
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: token.trim(),
        type: "email",
      });
      if (error) return { error: error.message };
      await refresh();
      return {};
    },

    signOut: async () => {
      await supabase.auth.signOut();
      setCustomer(null);
      setSession(null);
    },

    resetPassword: async (email) => {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: storeAccountRedirect(slug),
      });
      return error ? { error: error.message } : {};
    },

    refresh,
  }), [loading, session, customer, slug, refresh]);

  return <StoreAuthContext.Provider value={value}>{children}</StoreAuthContext.Provider>;
}

export function useStoreAuth(): Ctx {
  const ctx = useContext(StoreAuthContext);
  if (!ctx) throw new Error("useStoreAuth debe usarse dentro de StoreAuthProvider");
  return ctx;
}
