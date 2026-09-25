import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

/**
 * Contexto del CREADOR (influencer).
 *
 * Es una superficie distinta del negocio: un creador no tiene organización,
 * ni membresías, ni stock. Ve sus campañas, entregables e ingresos de TODAS
 * sus marcas desde una sola bandeja, ligadas por el email de su cuenta.
 */
export interface CreatorProfile {
  user_id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  phone: string | null;
  instagram: string | null;
  tiktok: string | null;
  youtube: string | null;
  onboarding_completed: boolean;
}

export interface CreatorCampaign {
  id: string;
  org_id: string;
  org_name: string | null;
  title: string;
  brief: string | null;
  channel: string | null;
  due_date: string | null;
  status: string;
  budget_ars: number | null;
  invitation_status: string | null;
  deliverable_url: string | null;
  deliverable_status: string | null;
  /** Feedback de la marca tras revisar la entrega (aprobado o corrección). */
  review_notes: string | null;
  /** Publicación verificada por la marca: URL, plataforma y fecha. */
  publication_url: string | null;
  publication_platform: string | null;
  publication_verified_at: string | null;
  /** Resumen del chat de la colaboración (último mensaje y total). */
  chat_last_body: string | null;
  chat_last_at: string | null;
  chat_total: number | null;
}

export interface CreatorDeliverable {
  id: string;
  org_name: string | null;
  campaign_name: string | null;
  description: string | null;
  content_url: string | null;
  due_date: string | null;
  status: string;
}

export interface CreatorEarnings {
  total_commissions_ars: number;
  total_sales_count: number;
  paid_ars: number;
  pending_withdrawals_ars: number;
  available_ars: number;
}

/** Historial de retiros solicitados por el creador (todas sus marcas). */
export interface CreatorWithdrawal {
  id: string;
  amount_ars: number;
  status: "pending" | "approved" | "paid" | "rejected";
  created_at: string;
  processed_at: string | null;
}

interface CreatorCtx {
  loading: boolean;
  isCreator: boolean;
  profile: CreatorProfile | null;
  campaigns: CreatorCampaign[];
  deliverables: CreatorDeliverable[];
  earnings: CreatorEarnings | null;
  withdrawals: CreatorWithdrawal[];
  refresh: () => Promise<void>;
  saveProfile: (fields: Partial<Pick<CreatorProfile, "display_name" | "bio" | "phone" | "instagram" | "tiktok" | "youtube">>) => Promise<void>;
  /** Responde la invitación de una campaña (accept/decline) con la sesión. */
  respondCampaign: (campaignId: string, action: "accept" | "decline") => Promise<void>;
  /** Entrega el contenido de una campaña: URL pública obligatoria. */
  submitDeliverable: (campaignId: string, campaignName: string, description: string, contentUrl: string) => Promise<void>;
  /** Lee el hilo de chat de una colaboración del creador. */
  listChat: (campaignId: string) => Promise<CreatorChatMessage[]>;
  /** Escribe en el hilo de chat de una colaboración del creador. */
  sendChat: (campaignId: string, body: string) => Promise<CreatorChatMessage>;
}

/** Mensaje del hilo de una colaboración, tal como lo devuelve el RPC. */
export interface CreatorChatMessage {
  id: string;
  author_role: 'brand' | 'creator';
  body: string;
  created_at: string;
}

const CreatorContext = createContext<CreatorCtx | null>(null);

// deno-lint-ignore no-explicit-any
const rpc = (fn: string, args?: Record<string, unknown>) => (supabase as any).rpc(fn, args);

export function CreatorProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [isCreator, setIsCreator] = useState(false);
  const [profile, setProfile] = useState<CreatorProfile | null>(null);
  const [campaigns, setCampaigns] = useState<CreatorCampaign[]>([]);
  const [deliverables, setDeliverables] = useState<CreatorDeliverable[]>([]);
  const [earnings, setEarnings] = useState<CreatorEarnings | null>(null);
  const [withdrawals, setWithdrawals] = useState<CreatorWithdrawal[]>([]);

  const refresh = useCallback(async () => {
    if (!user) {
      setIsCreator(false);
      setProfile(null);
      setCampaigns([]);
      setDeliverables([]);
      setEarnings(null);
      setWithdrawals([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // La cuenta es creadora si tiene fila en creator_accounts.
      const { data: ownRow } = await rpc("creator_linked_profiles", { p_user_id: user.id });
      const linked = Array.isArray(ownRow) ? ownRow : [];

      let own: CreatorProfile | null = null;
      // deno-lint-ignore no-explicit-any
      const accounts = (supabase as any).from("creator_accounts");
      const { data: accountRow } = await accounts.select("*").eq("user_id", user.id).maybeSingle();
      own = (accountRow as CreatorProfile | null) ?? null;

      // Si no tiene fila pero SÍ perfiles ligados por email, la cuenta existe:
      // se siembra su fila para que el resto de RPCs funcionen.
      if (!own && linked.length > 0) {
        const email = user.email ?? "";
        await accounts.insert({ user_id: user.id, email });
        own = { user_id: user.id, email, display_name: null, avatar_url: null, bio: null, phone: null, instagram: null, tiktok: null, youtube: null, onboarding_completed: false };
      }

      setIsCreator(Boolean(own) || linked.length > 0);
      setProfile(own);

      if (own) {
        const [camp, deliv, earn, wd] = await Promise.all([
          rpc("creator_campaigns"),
          rpc("creator_deliverables"),
          rpc("creator_earnings"),
          rpc("creator_my_withdrawals"),
        ]);
        setCampaigns(Array.isArray(camp.data) ? camp.data : []);
        setDeliverables(Array.isArray(deliv.data) ? deliv.data : []);
        const earnData = earn.data;
        const parsed = typeof earnData === "string" ? JSON.parse(earnData) : earnData;
        setEarnings((parsed as CreatorEarnings) ?? null);
        setWithdrawals(Array.isArray(wd.data) ? wd.data : []);
      } else {
        setCampaigns([]);
        setDeliverables([]);
        setEarnings(null);
        setWithdrawals([]);
      }
    } catch (error) {
      console.error("[creator] no se pudo cargar la superficie de creador", error);
      setIsCreator(false);
      setProfile(null);
      setCampaigns([]);
      setDeliverables([]);
      setEarnings(null);
      setWithdrawals([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { if (!authLoading) void refresh(); }, [authLoading, refresh]);

  const saveProfile = useCallback(async (
    fields: Partial<Pick<CreatorProfile, "display_name" | "bio" | "phone" | "instagram" | "tiktok" | "youtube">>,
  ) => {
    // La firma del RPC es un solo objeto con las 6 claves.
    const { error } = await rpc("creator_upsert_own_profile", {
      p_display_name: fields.display_name ?? null,
      p_bio: fields.bio ?? null,
      p_phone: fields.phone ?? null,
      p_instagram: fields.instagram ?? null,
      p_tiktok: fields.tiktok ?? null,
      p_youtube: fields.youtube ?? null,
    });
    if (error) throw error;
    await refresh();
  }, [refresh]);

  const respondCampaign = useCallback(async (campaignId: string, action: "accept" | "decline") => {
    const { error } = await rpc("creator_respond_campaign", { p_campaign_id: campaignId, p_action: action });
    if (error) throw error;
    await refresh();
  }, [refresh]);

  const submitDeliverable = useCallback(async (
    campaignId: string, campaignName: string, description: string, contentUrl: string,
  ) => {
    const { error } = await rpc("creator_submit_deliverable", {
      p_campaign_id: campaignId,
      p_campaign_name: campaignName,
      p_description: description,
      p_content_url: contentUrl,
    });
    if (error) throw error;
    await refresh();
  }, [refresh]);

  const listChat = useCallback(async (campaignId: string): Promise<CreatorChatMessage[]> => {
    const { data, error } = await rpc("campaign_chat_list", { p_campaign_id: campaignId });
    if (error) throw error;
    return (Array.isArray(data) ? data : []) as CreatorChatMessage[];
  }, []);

  const sendChat = useCallback(async (campaignId: string, body: string): Promise<CreatorChatMessage> => {
    const { data, error } = await rpc("campaign_chat_send", { p_campaign_id: campaignId, p_body: body });
    if (error) throw error;
    return data as CreatorChatMessage;
  }, []);

  return (
    <CreatorContext.Provider value={{ loading, isCreator, profile, campaigns, deliverables, earnings, withdrawals, refresh, saveProfile, respondCampaign, submitDeliverable, listChat, sendChat }}>
      {children}
    </CreatorContext.Provider>
  );
}

export function useCreator(): CreatorCtx {
  const ctx = useContext(CreatorContext);
  if (!ctx) throw new Error("useCreator debe usarse dentro de CreatorProvider");
  return ctx;
}
