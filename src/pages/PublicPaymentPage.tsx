import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { formatARS } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { CreditCard, Banknote, MessageCircle, CheckCircle2, Clock, XCircle, Copy, ExternalLink, AlertTriangle } from "lucide-react";

type PaymentLink = {
  id: string;
  org_id: string;
  quote_number: string | null;
  customer_name: string;
  customer_phone: string | null;
  items: Array<{ description: string; qty: number; unitPrice: number; total: number }>;
  total_ars: number;
  mp_link: string | null;
  status: "pending" | "pending_confirmation" | "paid" | "cancelled";
  paid_at: string | null;
  notes: string | null;
  expires_at: string | null;
};

type OrgInfo = {
  name: string;
  whatsapp_number: string | null;
  bank_cbu: string | null;
  bank_alias: string | null;
  bank_name: string | null;
  bank_holder: string | null;
};

export default function PublicPaymentPage() {
  const { linkId } = useParams<{ linkId: string }>();
  const [link, setLink] = useState<PaymentLink | null>(null);
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (!linkId) { setNotFound(true); setLoading(false); return; }
    (async () => {
      const { data: linkData } = await supabase
        .from("payment_links")
        .select("*")
        .eq("id", linkId)
        .maybeSingle();

      if (!linkData) { setNotFound(true); setLoading(false); return; }
      const pl = linkData as PaymentLink;
      setLink(pl);

      const { data: settingsData } = await supabase
        .from("settings")
        .select("bank_cbu, bank_alias, bank_name, bank_holder, whatsapp_number")
        .eq("org_id", pl.org_id)
        .maybeSingle();

      const { data: orgData } = await supabase
        .from("organizations")
        .select("name")
        .eq("id", pl.org_id)
        .maybeSingle();

      setOrg({
        name: orgData?.name || "Tienda",
        whatsapp_number: settingsData?.whatsapp_number || null,
        bank_cbu: settingsData?.bank_cbu || null,
        bank_alias: settingsData?.bank_alias || null,
        bank_name: settingsData?.bank_name || null,
        bank_holder: settingsData?.bank_holder || null,
      });

      setLoading(false);
    })();
  }, [linkId]);

  const confirmTransfer = async () => {
    if (!link) return;
    setConfirming(true);
    try {
      const { error } = await supabase
        .from("payment_links")
        .update({ status: "pending_confirmation" })
        .eq("id", link.id);
      if (error) throw error;
      setLink(prev => prev ? { ...prev, status: "pending_confirmation" } : prev);
      setConfirmed(true);
      toast.success("¡Listo! Le avisamos al vendedor que realizaste la transferencia.");
    } catch {
      toast.error("Error al confirmar. Contactá al vendedor directamente.");
    } finally {
      setConfirming(false);
    }
  };

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copiado`);
  };

  const isExpired = link?.expires_at && new Date(link.expires_at) < new Date();
  const isPaid = link?.status === "paid";
  const isPendingConfirmation = link?.status === "pending_confirmation";
  const isCancelled = link?.status === "cancelled";

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <div className="w-8 h-8 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (notFound || !link) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
        <div className="text-center text-white">
          <AlertTriangle className="w-12 h-12 text-amber-400 mx-auto mb-4" />
          <h1 className="text-xl font-bold mb-2">Link no encontrado</h1>
          <p className="text-slate-400 text-sm">Este link de pago no existe o fue cancelado.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 py-8 px-4">
      <div className="max-w-md mx-auto">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-[10px] bg-amber-400/10 border border-amber-400/20 mb-3">
            <CreditCard className="w-7 h-7 text-amber-400" />
          </div>
          <h1 className="text-xl font-bold text-white">{org?.name}</h1>
          {link.quote_number && (
            <p className="text-slate-400 text-sm mt-0.5">Presupuesto {link.quote_number}</p>
          )}
        </div>

        {/* Status banner */}
        {isPaid && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 mb-5 flex items-center gap-3">
            <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
            <div>
              <p className="text-emerald-300 font-semibold text-sm">Pago confirmado</p>
              <p className="text-slate-400 text-xs">Gracias por tu compra, {link.customer_name.split(" ")[0]}!</p>
            </div>
          </div>
        )}

        {isPendingConfirmation && !confirmed && (
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 mb-5 flex items-center gap-3">
            <Clock className="w-6 h-6 text-blue-400 shrink-0" />
            <div>
              <p className="text-blue-300 font-semibold text-sm">Esperando confirmación</p>
              <p className="text-slate-400 text-xs">Le avisamos al vendedor. Te contactará pronto.</p>
            </div>
          </div>
        )}

        {isCancelled && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-5 flex items-center gap-3">
            <XCircle className="w-6 h-6 text-red-400 shrink-0" />
            <div>
              <p className="text-red-300 font-semibold text-sm">Link cancelado</p>
              <p className="text-slate-400 text-xs">Contactá al vendedor para más información.</p>
            </div>
          </div>
        )}

        {isExpired && !isPaid && (
          <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl p-4 mb-5 flex items-center gap-3">
            <AlertTriangle className="w-6 h-6 text-orange-400 shrink-0" />
            <div>
              <p className="text-orange-300 font-semibold text-sm">Presupuesto vencido</p>
              <p className="text-slate-400 text-xs">Contactá al vendedor para actualizar el precio.</p>
            </div>
          </div>
        )}

        {/* Customer + total */}
        <div className="bg-slate-800/60 border border-slate-700 rounded-[10px] p-5 mb-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-slate-400 text-xs uppercase tracking-wider mb-0.5">Para</p>
              <p className="text-white font-semibold">{link.customer_name}</p>
            </div>
            <div className="text-right">
              <p className="text-slate-400 text-xs uppercase tracking-wider mb-0.5">Total a pagar</p>
              <p className="text-amber-400 text-2xl font-bold">{formatARS(link.total_ars)}</p>
            </div>
          </div>

          {/* Items */}
          {(link.items || []).length > 0 && (
            <div className="border-t border-slate-700 pt-3 space-y-1.5">
              {(link.items as { qty: number; description: string; unit_price: number }[]).map((item, i) => (
                <div key={i} className="flex items-start justify-between text-sm">
                  <span className="text-slate-300 flex-1 pr-2">
                    {item.qty > 1 && <span className="text-slate-500 mr-1">{item.qty}×</span>}
                    {item.description}
                  </span>
                  <span className="text-slate-400 shrink-0">{formatARS(item.total || item.qty * item.unitPrice)}</span>
                </div>
              ))}
            </div>
          )}

          {link.notes && (
            <p className="text-xs text-slate-400 mt-3 border-t border-slate-700 pt-3">{link.notes}</p>
          )}
        </div>

        {/* Payment options — only if not paid/cancelled/expired */}
        {!isPaid && !isCancelled && !isExpired && (
          <div className="space-y-3">
            {/* MercadoPago */}
            {link.mp_link && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-[10px] p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-7 h-7 rounded-lg bg-[#009ee3]/10 flex items-center justify-center">
                    <CreditCard className="w-4 h-4 text-[#009ee3]" />
                  </div>
                  <div>
                    <p className="text-white text-sm font-semibold">MercadoPago</p>
                    <p className="text-slate-400 text-xs">Tarjeta de crédito, débito, cuotas</p>
                  </div>
                </div>
                <Button
                  className="w-full bg-[#009ee3] hover:bg-[#0081c1] text-white font-semibold"
                  onClick={() => window.open(link.mp_link!, "_blank")}
                >
                  <ExternalLink className="w-4 h-4 mr-2" />Pagar con MercadoPago
                </Button>
              </div>
            )}

            {/* Bank transfer */}
            {(org?.bank_cbu || org?.bank_alias) && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-[10px] p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                    <Banknote className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-white text-sm font-semibold">Transferencia bancaria</p>
                    <p className="text-slate-400 text-xs">Sin comisión adicional</p>
                  </div>
                </div>

                <div className="space-y-2 mb-3">
                  {org.bank_holder && (
                    <div className="flex items-center justify-between bg-slate-900/50 rounded-lg px-3 py-2">
                      <span className="text-slate-400 text-xs">Titular</span>
                      <span className="text-white text-sm font-medium">{org.bank_holder}</span>
                    </div>
                  )}
                  {org.bank_name && (
                    <div className="flex items-center justify-between bg-slate-900/50 rounded-lg px-3 py-2">
                      <span className="text-slate-400 text-xs">Banco</span>
                      <span className="text-white text-sm">{org.bank_name}</span>
                    </div>
                  )}
                  {org.bank_cbu && (
                    <div className="flex items-center justify-between bg-slate-900/50 rounded-lg px-3 py-2">
                      <span className="text-slate-400 text-xs">CBU</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-white text-sm font-mono">{org.bank_cbu}</span>
                        <button onClick={() => copy(org.bank_cbu!, "CBU")} className="text-slate-500 hover:text-amber-400 transition-colors">
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                  {org.bank_alias && (
                    <div className="flex items-center justify-between bg-slate-900/50 rounded-lg px-3 py-2">
                      <span className="text-slate-400 text-xs">Alias</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-white text-sm font-mono">{org.bank_alias}</span>
                        <button onClick={() => copy(org.bank_alias!, "Alias")} className="text-slate-500 hover:text-amber-400 transition-colors">
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {!isPendingConfirmation && !confirmed && (
                  <Button
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                    onClick={confirmTransfer}
                    disabled={confirming}
                  >
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    {confirming ? "Enviando confirmación…" : "Ya transferí — Avisar al vendedor"}
                  </Button>
                )}
                {(isPendingConfirmation || confirmed) && (
                  <div className="flex items-center gap-2 text-sm text-blue-300 bg-blue-500/10 rounded-lg px-3 py-2">
                    <Clock className="w-4 h-4 shrink-0" />
                    El vendedor verificará el pago y confirmará en breve.
                  </div>
                )}
              </div>
            )}

            {/* WhatsApp contact */}
            {org?.whatsapp_number && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-[10px] p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-7 h-7 rounded-lg bg-green-500/10 flex items-center justify-center">
                    <MessageCircle className="w-4 h-4 text-green-400" />
                  </div>
                  <div>
                    <p className="text-white text-sm font-semibold">Efectivo o consulta</p>
                    <p className="text-slate-400 text-xs">Hablá directo con el vendedor</p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  className="w-full border-green-500/30 text-green-400 hover:bg-green-500/10"
                  onClick={() => window.open(
                    `https://wa.me/${org.whatsapp_number!.replace(/\D/g, "")}?text=${encodeURIComponent(
                      `Hola! Quiero coordinar el pago del presupuesto ${link.quote_number || link.id.slice(0, 8)} por ${formatARS(link.total_ars)}.`
                    )}`,
                    "_blank"
                  )}
                >
                  <MessageCircle className="w-4 h-4 mr-2" />Escribir por WhatsApp
                </Button>
              </div>
            )}
          </div>
        )}

        <p className="text-center text-slate-600 text-xs mt-6">
          Pago seguro • Gestiona &copy; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
