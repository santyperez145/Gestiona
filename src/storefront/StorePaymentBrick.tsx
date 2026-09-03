import { useEffect, useRef, useState } from "react";
import { initMercadoPago, Payment } from "@mercadopago/sdk-react";
import { Loader2, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export interface StorePaymentBrickConfig {
  publicKey: string;
  amount: number;
}

interface StorePaymentBrickProps {
  slug: string;
  orderNumber: string;
  accessToken: string | null;
  config: StorePaymentBrickConfig;
  onResult: (status: string) => void;
}

const newAttemptKey = () => crypto.randomUUID();

/**
 * Tarjetas dentro de la tienda sin que su número pase nunca por Nerqia.
 * MercadoPago tokeniza el dato sensible y el backend sólo recibe ese token
 * efímero, vuelve a leer la orden y crea el pago con el importe autoritativo.
 */
export default function StorePaymentBrick({ slug, orderNumber, accessToken, config, onResult }: StorePaymentBrickProps) {
  const [sdkReady, setSdkReady] = useState(false);
  const [brickError, setBrickError] = useState<string | null>(null);
  const attemptKey = useRef(newAttemptKey());

  useEffect(() => {
    // La librería mantiene una instancia global. Re-inicializar cuando cambia
    // la tienda evita usar la clave pública de un comercio anterior si alguien
    // abre dos tiendas distintas sin recargar la SPA.
    initMercadoPago(config.publicKey, { locale: "es-AR" });
    setSdkReady(true);
  }, [config.publicKey]);

  if (!sdkReady) {
    return (
      <div className="py-8 grid place-items-center" aria-live="polite">
        <Loader2 className="w-5 h-5 animate-spin opacity-50" />
      </div>
    );
  }

  return (
    <div className="text-left">
      <div className="flex gap-2 items-start px-1 mb-2 text-xs" style={{ color: "hsl(var(--st-muted))" }}>
        <ShieldCheck className="w-4 h-4 shrink-0" style={{ color: "hsl(var(--st-accent))" }} />
        <p>Los datos de tu tarjeta los procesa MercadoPago de forma segura.</p>
      </div>

      <Payment
        key={`${config.publicKey}:${config.amount}`}
        initialization={{ amount: config.amount }}
        customization={{
          // Wallet, efectivo y otros medios siguen disponibles por el checkout
          // externo. Este camino usa sólo tarjetas y nunca necesita exponer una
          // preferencia ni datos de la persona que hizo el pedido.
          paymentMethods: {
            creditCard: "all",
            debitCard: "all",
            prepaidCard: "all",
            maxInstallments: 24,
          },
        }}
        locale="es-AR"
        onError={() => {
          setBrickError("No pudimos cargar el pago con tarjeta. Probá de nuevo o elegí otro medio.");
        }}
        onSubmit={async ({ formData }) => {
          setBrickError(null);
          const { data, error } = await supabase.functions.invoke("store-pay", {
            body: {
              action: "brick-payment",
              slug,
              orderNumber,
              accessToken,
              formData,
              attemptKey: attemptKey.current,
            },
          });
          const result = data as { status?: string; error?: string } | null;
          if (error || result?.error) {
            // El token puede haber sido rechazado antes de crear un pago: para
            // otra tarjeta se necesita una clave de idempotencia nueva.
            attemptKey.current = newAttemptKey();
            const message = result?.error ?? "No se pudo procesar el pago. Revisá los datos o probá otro medio.";
            setBrickError(message);
            throw new Error(message);
          }

          const status = result?.status ?? "pending";
          if (status === "rejected" || status === "cancelled") {
            attemptKey.current = newAttemptKey();
            const message = "El pago fue rechazado. Podés revisar los datos o usar otro medio.";
            setBrickError(message);
            throw new Error(message);
          }

          onResult(status);
        }}
      />

      {brickError && <p className="px-1 mt-2 text-xs text-red-600" role="alert">{brickError}</p>}
    </div>
  );
}
