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
  public_slug: string | null;
  profile_public: boolean;
  discoverable: boolean;
  category: string | null;
  city: string | null;
  country_code: string;
  rate_from_ars: number | null;
  moderation_status: "draft" | "pending" | "approved" | "rejected";
  moderation_notes: string | null;
  identity_status: "unverified" | "pending" | "verified" | "rejected";
}

export interface CreatorPublicProfileInput {
  public_slug: string;
  profile_public: boolean;
  discoverable: boolean;
  category: string;
  city: string;
  country_code: string;
  rate_from_ars: number | null;
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
  payout_provider_label: string | null;
  payout_identifier_masked: string | null;
  payment_reference: string | null;
  paid_at: string | null;
}

export interface CreatorPayoutDestination {
  id: string;
  provider: "mercadopago" | "bank_transfer" | "virtual_wallet" | "other";
  destination_type: "email" | "cbu" | "cvu" | "alias" | "wallet_handle";
  provider_label: string;
  holder_name: string;
  identifier_masked: string;
  currency: "ARS";
  is_default: boolean;
  created_at: string;
}

export interface CreatorPayoutDestinationInput {
  provider: CreatorPayoutDestination["provider"];
  destination_type: CreatorPayoutDestination["destination_type"];
  provider_label: string;
  holder_name: string;
  identifier: string;
}

/** Contrato visible para el creador: condiciones + estado de doble aceptación. */
export interface CreatorContract {
  id: string;
  org_id: string;
  org_name: string | null;
  influencer_name: string;
  contract_type: "fixed" | "percentage" | "hybrid";
  contract_amount: number;
  commission_percent: number;
  valid_from: string;
  valid_until: string | null;
  status: string;
  version: number;
  is_signed: boolean;
  creator_accepted: boolean;
  creator_accepted_at: string | null;
  notes: string | null;
}

export interface CreatorLinkedProfile {
  id: string;
  org_id: string;
  org_name: string | null;
  name: string;
  instagram: string | null;
  status: string;
  commission_percent: number | null;
}

export interface CreatorSocialMetricReport {
  id: string;
  org_id: string;
  org_name: string | null;
  influencer_id: string;
  influencer_name: string;
  platform: "instagram" | "tiktok" | "youtube";
  metric_kind: "captura" | "export_csv";
  evidence_url: string;
  period_start: string;
  period_end: string;
  followers: number;
  reach: number | null;
  impressions: number | null;
  engagement_rate: number | null;
  notes: string | null;
  status: "submitted" | "verified" | "rejected";
  reviewed_at: string | null;
  review_notes: string | null;
  created_at: string;
}

export interface CreatorMetricReportInput {
  influencer_id: string;
  platform: CreatorSocialMetricReport["platform"];
  metric_kind: CreatorSocialMetricReport["metric_kind"];
  evidence_url: string;
  period_start: string;
  period_end: string;
  followers: number;
  reach: number | null;
  impressions: number | null;
  engagement_rate: number | null;
  notes: string | null;
}

interface CreatorCtx {
  loading: boolean;
  isCreator: boolean;
  profile: CreatorProfile | null;
  campaigns: CreatorCampaign[];
  deliverables: CreatorDeliverable[];
  earnings: CreatorEarnings | null;
  withdrawals: CreatorWithdrawal[];
  payoutDestinations: CreatorPayoutDestination[];
  contracts: CreatorContract[];
  linkedProfiles: CreatorLinkedProfile[];
  metricReports: CreatorSocialMetricReport[];
  refresh: () => Promise<void>;
  saveProfile: (fields: Partial<Pick<CreatorProfile, "display_name" | "bio" | "phone" | "instagram" | "tiktok" | "youtube">>) => Promise<void>;
  savePublicProfile: (fields: CreatorPublicProfileInput) => Promise<void>;
  /** Responde la invitación de una campaña (accept/decline) con la sesión. */
  respondCampaign: (campaignId: string, action: "accept" | "decline") => Promise<void>;
  /** Entrega el contenido de una campaña: URL pública obligatoria. */
  submitDeliverable: (campaignId: string, campaignName: string, description: string, contentUrl: string) => Promise<void>;
  /** Lee el hilo de chat de una colaboración del creador. */
  listChat: (campaignId: string) => Promise<CreatorChatMessage[]>;
  /** Escribe en el hilo de chat de una colaboración del creador. */
  sendChat: (campaignId: string, body: string) => Promise<CreatorChatMessage>;
  /** Acepta la versión vigente de un contrato con firma declarada. */
  acceptContract: (contractId: string, signatureName: string) => Promise<void>;
  /** Envía métricas sociales con evidencia para revisión de la marca. */
  submitMetricReport: (input: CreatorMetricReportInput) => Promise<void>;
  savePayoutDestination: (input: CreatorPayoutDestinationInput) => Promise<void>;
  disablePayoutDestination: (destinationId: string) => Promise<void>;
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
  const [payoutDestinations, setPayoutDestinations] = useState<CreatorPayoutDestination[]>([]);
  const [contracts, setContracts] = useState<CreatorContract[]>([]);
  const [linkedProfiles, setLinkedProfiles] = useState<CreatorLinkedProfile[]>([]);
  const [metricReports, setMetricReports] = useState<CreatorSocialMetricReport[]>([]);

  const refresh = useCallback(async () => {
    if (!user) {
      setIsCreator(false);
      setProfile(null);
      setCampaigns([]);
      setDeliverables([]);
      setEarnings(null);
      setWithdrawals([]);
      setPayoutDestinations([]);
      setContracts([]);
      setLinkedProfiles([]);
      setMetricReports([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // La cuenta es creadora si tiene fila en creator_accounts.
      const { data: ownRow } = await rpc("creator_linked_profiles", { p_user_id: user.id });
      const linked = Array.isArray(ownRow) ? ownRow : [];
      setLinkedProfiles(linked as CreatorLinkedProfile[]);

      let own: CreatorProfile | null = null;
      // deno-lint-ignore no-explicit-any
      const accounts = (supabase as any).from("creator_accounts");
      const { data: accountRow } = await accounts.select("*").eq("user_id", user.id).maybeSingle();
      own = (accountRow as CreatorProfile | null) ?? null;

      // Si no tiene fila pero SÍ perfiles ligados por email, la cuenta existe:
      // se siembra su fila para que el resto de RPCs funcionen.
      if (!own && linked.length > 0) {
        const email = user.email ?? "";
        const { error: ensureError } = await rpc("creator_ensure_account");
        if (ensureError) throw ensureError;
        own = { user_id: user.id, email, display_name: null, avatar_url: null, bio: null, phone: null, instagram: null, tiktok: null, youtube: null, onboarding_completed: false, public_slug: null, profile_public: false, discoverable: false, category: null, city: null, country_code: "AR", rate_from_ars: null, moderation_status: "draft", moderation_notes: null, identity_status: "unverified" };
      }

      setIsCreator(Boolean(own) || linked.length > 0);
      setProfile(own);

      if (own) {
        const [camp, deliv, earn, wd, ctr, metrics, destinations] = await Promise.all([
          rpc("creator_campaigns"),
          rpc("creator_deliverables"),
          rpc("creator_earnings"),
          rpc("creator_my_withdrawals"),
          rpc("creator_my_contracts"),
          rpc("creator_my_social_metric_reports"),
          rpc("creator_payout_destinations_list"),
        ]);
        setCampaigns(Array.isArray(camp.data) ? camp.data : []);
        setDeliverables(Array.isArray(deliv.data) ? deliv.data : []);
        const earnData = earn.data;
        const parsed = typeof earnData === "string" ? JSON.parse(earnData) : earnData;
        setEarnings((parsed as CreatorEarnings) ?? null);
        setWithdrawals(Array.isArray(wd.data) ? wd.data : []);
        setContracts(Array.isArray(ctr.data) ? ctr.data : []);
        setMetricReports(Array.isArray(metrics.data) ? metrics.data : []);
        setPayoutDestinations(Array.isArray(destinations.data) ? destinations.data : []);
      } else {
        setCampaigns([]);
        setDeliverables([]);
        setEarnings(null);
        setWithdrawals([]);
        setPayoutDestinations([]);
        setContracts([]);
        setMetricReports([]);
      }
    } catch (error) {
      console.error("[creator] no se pudo cargar la superficie de creador", error);
      setIsCreator(false);
      setProfile(null);
      setCampaigns([]);
      setDeliverables([]);
      setEarnings(null);
      setWithdrawals([]);
      setPayoutDestinations([]);
      setContracts([]);
      setLinkedProfiles([]);
      setMetricReports([]);
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

  const savePublicProfile = useCallback(async (fields: CreatorPublicProfileInput) => {
    const { error } = await rpc("creator_update_public_profile", {
      p_public_slug: fields.public_slug,
      p_profile_public: fields.profile_public,
      p_discoverable: fields.discoverable,
      p_category: fields.category,
      p_city: fields.city,
      p_country_code: fields.country_code,
      p_rate_from_ars: fields.rate_from_ars,
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

  const acceptContract = useCallback(async (contractId: string, signatureName: string) => {
    const { error } = await rpc("accept_influencer_contract", {
      p_contract_id: contractId,
      p_signature_name: signatureName,
    });
    if (error) throw error;
    await refresh();
  }, [refresh]);

  const submitMetricReport = useCallback(async (input: CreatorMetricReportInput) => {
    const { error } = await rpc("submit_social_metric_report", {
      p_influencer_id: input.influencer_id,
      p_platform: input.platform,
      p_evidence_url: input.evidence_url,
      p_period_start: input.period_start,
      p_period_end: input.period_end,
      p_followers: input.followers,
      p_reach: input.reach,
      p_impressions: input.impressions,
      p_engagement_rate: input.engagement_rate,
      p_metric_kind: input.metric_kind,
      p_notes: input.notes,
    });
    if (error) throw error;
    await refresh();
  }, [refresh]);

  const savePayoutDestination = useCallback(async (input: CreatorPayoutDestinationInput) => {
    const { error } = await rpc("creator_payout_destination_save", {
      p_provider: input.provider,
      p_destination_type: input.destination_type,
      p_provider_label: input.provider_label,
      p_holder_name: input.holder_name,
      p_identifier: input.identifier,
      p_is_default: true,
    });
    if (error) throw error;
    await refresh();
  }, [refresh]);

  const disablePayoutDestination = useCallback(async (destinationId: string) => {
    const { error } = await rpc("creator_payout_destination_disable", { p_destination_id: destinationId });
    if (error) throw error;
    await refresh();
  }, [refresh]);

  return (
    <CreatorContext.Provider value={{ loading, isCreator, profile, campaigns, deliverables, earnings, withdrawals, payoutDestinations, contracts, linkedProfiles, metricReports, refresh, saveProfile, savePublicProfile, respondCampaign, submitDeliverable, listChat, sendChat, acceptContract, submitMetricReport, savePayoutDestination, disablePayoutDestination }}>
      {children}
    </CreatorContext.Provider>
  );
}

export function useCreator(): CreatorCtx {
  const ctx = useContext(CreatorContext);
  if (!ctx) throw new Error("useCreator debe usarse dentro de CreatorProvider");
  return ctx;
}
