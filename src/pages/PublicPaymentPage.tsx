import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { formatARS } from "@/lib/supabaseStore";
import {
  fetchPublicPaymentLink, confirmPaymentLinkTransfer,
} from "@/lib/publicDataSource";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  CreditCard, Banknote, MessageCircle, CheckCircle2, Clock,
  XCircle, Copy, ExternalLink, AlertTriangle, Shield, Lock,
  RefreshCw, Timer,
} from "lucide-react";

type PaymentLink = {
  id: string;
  org_id: string;
  quote_number: string | null;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
  items: Array<{ description: string; qty: number; unitPrice?: number; unit_price?: number; total?: number }>;
  total_ars: number;
  mp_link: string | null;
  status: "pending" | "pending_confirmation" | "paid" | "cancelled";
  paid_at: string | null;
  notes: string | null;
  expires_at: string | null;
};

type OrgInfo = {
  name: string;
  logo_url: string | null;
  whatsapp_number: string | null;
  bank_cbu: string | null;
  bank_alias: string | null;
  bank_name: string | null;
  bank_holder: string | null;
};

// ─── Countdown hook ───────────────────────────────────────────────────────────
function useCountdown(expiresAt: string | null) {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!expiresAt) { setRemaining(null); return; }
    const calc = () => Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
    setRemaining(calc());
    const id = setInterval(() => setRemaining(calc()), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  if (remaining === null) return null;
  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = remaining % 60;
  return { h, m, s, expired: remaining === 0, total: remaining };
}

// ─── Copy button ──────────────────────────────────────────────────────────────
function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="flex items-center justify-between bg-slate-900/60 rounded-lg px-3 py-2.5 gap-2">
      <span className="text-slate-400 text-xs shrink-0">{label}</span>
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-white text-sm font-mono truncate">{value}</span>
        <button
          onClick={handleCopy}
          className="shrink-0 text-slate-500 hover:text-amber-400 transition-colors"
        >
          {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function PublicPaymentPage() {
  const { linkId } = useParams<{ linkId: string }>();
  const [link, setLink] = useState<PaymentLink | null>(null);
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [activeMethod, setActiveMethod] = useState<"mp" | "transfer" | null>(null);

  const countdown = useCountdown(link?.expires_at ?? null);

  // ── Load ────────────────────────────────────────────────────────────────────
  const fetchLink = useCallback(async (silent = false) => {
    if (!linkId) { setNotFound(true); setLoading(false); return; }
    if (!silent) setLoading(true);
    try {
      // Vía RPC: el uuid del link es el secreto, y así no se puede enumerar el
      // resto. Antes `payment_links` y `settings` estaban abiertas con
      // USING(true) y se listaban los links y los datos bancarios de todos los
      // comercios de la plataforma.
      const lectura = await fetchPublicPaymentLink(linkId);
      if (!lectura.ok) {
        if (!silent) {
          setLoadError(true);
          setNotFound(false);
          setLoading(false);
        }
        return;
      }
      if (!lectura.data) {
        setNotFound(true);
        setLoadError(false);
        setLoading(false);
        return;
      }

      const row = lectura.data;
      setLoadError(false);
      setNotFound(false);

      // `items` es jsonb en DB → llega como Json genérico
      setLink(row as unknown as PaymentLink);

      if (!org) {
        const r = row as Record<string, string | null>;
        setOrg({
          name: r.business_name || "Tienda",
          logo_url: r.logo_url || null,
          whatsapp_number: r.whatsapp_number || null,
          bank_cbu: r.bank_cbu || null,
          bank_alias: r.bank_alias || null,
          bank_name: r.bank_name || null,
          bank_holder: r.bank_holder || null,
        });
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [linkId]);

  useEffect(() => { fetchLink(); }, [fetchLink]);

  // Poll for payment confirmation every 15s
  useEffect(() => {
    if (!link || link.status === "paid" || link.status === "cancelled") return;
    const id = setInterval(() => fetchLink(true), 15_000);
    return () => clearInterval(id);
  }, [link?.status, fetchLink]);

  // ── Confirm transfer ──────────────────────────────────────────────────────────
  const confirmTransfer = async () => {
    if (!link) return;
    setConfirming(true);
    try {
      // RPC acotado: sólo avanza pending → pending_confirmation de ESTE link.
      // La política de UPDATE anterior era USING(true): cualquiera podía marcar
      // como pagado cualquier link de cualquier comercio.
      const ok = await confirmPaymentLinkTransfer(link.id);
      if (!ok) {
        toast.error("Este link ya no está esperando el pago. Contactá al vendedor.");
        fetchLink(true);
        return;
      }
      setLink(prev => prev ? { ...prev, status: "pending_confirmation" } : prev);
      setConfirmed(true);
      toast.success("¡Perfecto! Le avisamos al vendedor que realizaste la transferencia.");
    } catch {
      toast.error("Error al confirmar. Contactá al vendedor directamente.");
    } finally {
      setConfirming(false);
    }
  };

  // ── States ────────────────────────────────────────────────────────────────────
  const isExpired   = !!(link?.expires_at && new Date(link.expires_at) < new Date() && link.status === "pending");
  const isPaid      = link?.status === "paid";
  const isPendConf  = link?.status === "pending_confirmation";
  const isCancelled = link?.status === "cancelled";
  const canPay      = !isPaid && !isCancelled && !isExpired;

  // ── Loading ───────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0a0a1a] via-[#0e0e1e] to-[#0a0a1a]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-400 text-sm">Cargando link de pago...</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0a0a1a] via-[#0e0e1e] to-[#0a0a1a] p-4">
        <div className="text-center max-w-sm" data-payment-state="error" role="alert">
          <div className="w-16 h-16 rounded-full bg-amber-400/10 flex items-center justify-center mx-auto mb-4">
            <RefreshCw className="w-8 h-8 text-amber-400" />
          </div>
          <h1 className="text-xl font-bold text-white mb-2">No pudimos cargar el link</h1>
          <p className="text-slate-400 text-sm">La red falló. El link sigue siendo válido; reintentá.</p>
          <Button
            type="button"
            onClick={() => { void fetchLink(); }}
            className="mt-5 min-h-11 bg-amber-400 text-slate-950 hover:bg-amber-300"
          >
            Reintentar
          </Button>
        </div>
      </div>
    );
  }

  if (notFound || !link) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0a0a1a] via-[#0e0e1e] to-[#0a0a1a] p-4">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
            <XCircle className="w-8 h-8 text-red-400" />
          </div>
          <h1 className="text-xl font-bold text-white mb-2">Link no encontrado</h1>
          <p className="text-slate-400 text-sm">Este link de pago no existe, venció o fue cancelado. Contactá al vendedor para obtener uno nuevo.</p>
        </div>
      </div>
    );
  }

  const itemTotal = (item: PaymentLink["items"][0]) => {
    if (typeof item.total === "number") return item.total;
    const price = item.unitPrice ?? item.unit_price ?? 0;
    return item.qty * price;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a0a1a] via-[#0e0e1e] to-[#0a0a1a] py-8 px-4">
      <div className="max-w-md mx-auto space-y-4">

        {/* Header */}
        <div className="text-center py-2">
          {org?.logo_url ? (
            <img src={org.logo_url} alt={org.name} className="h-12 object-contain mx-auto mb-3 rounded-lg" />
          ) : (
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-[12px] bg-amber-400/10 border border-amber-400/20 mb-3">
              <CreditCard className="w-7 h-7 text-amber-400" />
            </div>
          )}
          <h1 className="text-lg font-bold text-white">{org?.name}</h1>
          {link.quote_number && <p className="text-slate-400 text-xs mt-0.5">Presupuesto #{link.quote_number}</p>}
        </div>

        {/* Status banners */}
        {isPaid && (
          <div className="bg-emerald-500/10 border border-emerald-500/40 rounded-[14px] p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-6 h-6 text-emerald-400" />
            </div>
            <div>
              <p className="text-emerald-300 font-bold text-base">¡Pago confirmado! ✓</p>
              <p className="text-slate-400 text-sm mt-0.5">Gracias, {link.customer_name.split(" ")[0]}. Tu pedido está procesado.</p>
              {link.paid_at && (
                <p className="text-slate-500 text-xs mt-1">
                  {new Intl.DateTimeFormat("es-AR", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" }).format(new Date(link.paid_at))}
                </p>
              )}
            </div>
          </div>
        )}

        {isPendConf && !confirmed && (
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-[14px] p-4 flex items-center gap-3">
            <Clock className="w-5 h-5 text-blue-400 shrink-0" />
            <div>
              <p className="text-blue-300 font-semibold text-sm">Esperando confirmación</p>
              <p className="text-slate-400 text-xs mt-0.5">El vendedor verificará el pago. Te contactará por WhatsApp.</p>
            </div>
          </div>
        )}

        {isCancelled && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-[14px] p-4 flex items-center gap-3">
            <XCircle className="w-5 h-5 text-red-400 shrink-0" />
            <div>
              <p className="text-red-300 font-semibold text-sm">Link cancelado</p>
              <p className="text-slate-400 text-xs mt-0.5">Contactá al vendedor para más información.</p>
            </div>
          </div>
        )}

        {isExpired && (
          <div className="bg-orange-500/10 border border-orange-500/30 rounded-[14px] p-4 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-orange-400 shrink-0" />
            <div>
              <p className="text-orange-300 font-semibold text-sm">Presupuesto vencido</p>
              <p className="text-slate-400 text-xs mt-0.5">Pedile al vendedor que genere un nuevo link.</p>
            </div>
          </div>
        )}

        {/* Countdown */}
        {canPay && countdown && !countdown.expired && countdown.total < 3600 * 6 && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-[10px] px-4 py-2.5 flex items-center gap-2">
            <Timer className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-xs text-amber-300 font-medium">
              Vence en {countdown.h > 0 ? `${countdown.h}h ` : ""}{String(countdown.m).padStart(2,"0")}:{String(countdown.s).padStart(2,"0")}
            </span>
          </div>
        )}

        {/* Order summary */}
        <div className="bg-slate-800/50 border border-slate-700/60 rounded-[14px] p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-slate-400 text-xs uppercase tracking-wider">Para</p>
              <p className="text-white font-semibold text-base mt-0.5">{link.customer_name}</p>
            </div>
            <div className="text-right">
              <p className="text-slate-400 text-xs uppercase tracking-wider">Total</p>
              <p className="text-amber-400 text-2xl font-bold mt-0.5">{formatARS(link.total_ars)}</p>
            </div>
          </div>

          {(link.items || []).length > 0 && (
            <div className="border-t border-slate-700/60 pt-3 space-y-2">
              {link.items.map((item, i) => (
                <div key={i} className="flex items-start justify-between text-sm gap-2">
                  <span className="text-slate-300 flex-1">
                    {item.qty > 1 && <span className="text-slate-500 mr-1.5 font-medium">{item.qty}×</span>}
                    {item.description}
                  </span>
                  <span className="text-slate-400 shrink-0 font-mono">{formatARS(itemTotal(item))}</span>
                </div>
              ))}
            </div>
          )}

          {link.notes && (
            <p className="text-xs text-slate-500 mt-3 pt-3 border-t border-slate-700/60 italic">{link.notes}</p>
          )}
        </div>

        {/* Payment methods */}
        {canPay && (
          <div className="space-y-3">
            <p className="text-xs text-slate-400 text-center font-medium uppercase tracking-wider">Elegí cómo pagar</p>

            {/* Mercado Pago */}
            {link.mp_link && (
              <div
                className={`bg-slate-800/50 border rounded-[14px] p-4 cursor-pointer transition-all ${
                  activeMethod === "mp"
                    ? "border-[#009ee3]/60 ring-1 ring-[#009ee3]/20"
                    : "border-slate-700/60 hover:border-slate-600"
                }`}
                onClick={() => setActiveMethod(m => m === "mp" ? null : "mp")}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#009ee3]/10 flex items-center justify-center shrink-0">
                    <span className="text-[#009ee3] font-black text-lg">MP</span>
                  </div>
                  <div className="flex-1">
                    <p className="text-white font-semibold text-sm">Mercado Pago</p>
                    <p className="text-slate-400 text-xs">Tarjeta, débito, Mercado Crédito, cuotas</p>
                  </div>
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                    activeMethod === "mp" ? "border-[#009ee3] bg-[#009ee3]" : "border-slate-600"
                  }`}>
                    {activeMethod === "mp" && <div className="w-2 h-2 rounded-full bg-white" />}
                  </div>
                </div>

                {activeMethod === "mp" && (
                  <div className="mt-4 pt-4 border-t border-slate-700/60">
                    <Button
                      className="w-full bg-[#009ee3] hover:bg-[#0081c1] text-white font-bold py-3 rounded-[10px] text-base"
                      onClick={e => { e.stopPropagation(); window.open(link.mp_link!, "_blank"); }}
                    >
                      <ExternalLink className="w-4 h-4 mr-2" />Ir a Mercado Pago
                    </Button>
                    <p className="text-center text-xs text-slate-500 mt-2">
                      Procesado de forma segura por Mercado Pago
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Bank transfer */}
            {(org?.bank_cbu || org?.bank_alias) && (
              <div
                className={`bg-slate-800/50 border rounded-[14px] p-4 cursor-pointer transition-all ${
                  activeMethod === "transfer"
                    ? "border-emerald-500/60 ring-1 ring-emerald-500/20"
                    : "border-slate-700/60 hover:border-slate-600"
                }`}
                onClick={() => setActiveMethod(m => m === "transfer" ? null : "transfer")}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
                    <Banknote className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div className="flex-1">
                    <p className="text-white font-semibold text-sm">Transferencia bancaria</p>
                    <p className="text-slate-400 text-xs">CBU / Alias · Sin comisión adicional</p>
                  </div>
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                    activeMethod === "transfer" ? "border-emerald-500 bg-emerald-500" : "border-slate-600"
                  }`}>
                    {activeMethod === "transfer" && <div className="w-2 h-2 rounded-full bg-white" />}
                  </div>
                </div>

                {activeMethod === "transfer" && (
                  <div className="mt-4 pt-4 border-t border-slate-700/60 space-y-2">
                    {org?.bank_holder && <CopyField label="Titular" value={org.bank_holder} />}
                    {org?.bank_name   && <CopyField label="Banco"   value={org.bank_name} />}
                    {org?.bank_cbu    && <CopyField label="CBU"     value={org.bank_cbu} />}
                    {org?.bank_alias  && <CopyField label="Alias"   value={org.bank_alias} />}
                    <CopyField label="Importe" value={formatARS(link.total_ars)} />

                    {!isPendConf && !confirmed ? (
                      <Button
                        className="w-full mt-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-[10px]"
                        onClick={e => { e.stopPropagation(); confirmTransfer(); }}
                        disabled={confirming}
                      >
                        {confirming
                          ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                          : <CheckCircle2 className="w-4 h-4 mr-2" />}
                        {confirming ? "Enviando aviso…" : "Ya transferí — Avisar al vendedor"}
                      </Button>
                    ) : (
                      <div className="flex items-center gap-2 text-sm text-blue-300 bg-blue-500/10 rounded-[8px] px-3 py-2.5 mt-2">
                        <Clock className="w-4 h-4 shrink-0" />
                        El vendedor verificará y confirmará tu pago. ¡Gracias!
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* WhatsApp contact */}
            {org?.whatsapp_number && (
              <Button
                variant="outline"
                className="w-full border-green-500/30 text-green-400 hover:bg-green-500/10 rounded-[10px] py-3 gap-2"
                onClick={() => window.open(
                  `https://wa.me/${org!.whatsapp_number!.replace(/\D/g, "")}?text=${encodeURIComponent(
                    `Hola! Quiero pagar el pedido ${link.quote_number ? `#${link.quote_number}` : ""} por ${formatARS(link.total_ars)}. ¿Cómo coordino?`
                  )}`, "_blank"
                )}
              >
                <MessageCircle className="w-4 h-4" />
                Consultar por WhatsApp
              </Button>
            )}
          </div>
        )}

        {/* Security badges */}
        <div className="flex items-center justify-center gap-4 py-2">
          <div className="flex items-center gap-1.5 text-slate-500 text-[10px]">
            <Shield className="w-3 h-3" />Transacción segura
          </div>
          <div className="flex items-center gap-1.5 text-slate-500 text-[10px]">
            <Lock className="w-3 h-3" />Datos protegidos
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-slate-600 text-[10px] pb-4">
          Powered by Nerqia · Link generado para {link.customer_name}
        </p>
      </div>
    </div>
  );
}
