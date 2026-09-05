/**
 * Contrato de fallos de correo por audiencia.
 *
 * El motivo original queda únicamente en logs de la Edge Function. Las
 * respuestas para comercios son accionables pero no revelan proveedor,
 * infraestructura ni secretos; las de compradores nunca hablan de la
 * plataforma. El staff sí recibe el diagnóstico operativo completo.
 */

export type EmailErrorAudience = "platform" | "merchant" | "customer";

export interface EmailFailureSource {
  provider?: string;
  error?: string;
  providerCode?: string;
  providerStatus?: number;
  retryable?: boolean;
}

export interface EmailFailureResponse {
  ok: false;
  code: string;
  retryable: boolean;
  reference: string;
  error: string;
  public_message: string;
  merchant_message: string;
  operator_message?: string;
  provider?: string;
}

function includesAny(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value));
}

function classification(source: EmailFailureSource) {
  const detail = String(source.error ?? "").trim();
  const code = String(source.providerCode ?? "").trim();
  const hay = `${code} ${detail}`;

  if (source.provider === "none" || includesAny(hay, [/no hay proveedor/i, /not configured/i])) {
    return {
      code: "EMAIL_NOT_CONFIGURED",
      retryable: false,
      merchant: "El envío de correo todavía no está configurado. Conectá una cuenta en Ajustes > Integraciones y volvé a intentar.",
    };
  }
  if (includesAny(hay, [/invalid[_ -]?api[_ -]?key/i, /unauthorized/i, /401\b/i, /535\b/i, /badcredentials/i, /username and password/i])) {
    return {
      code: "EMAIL_CREDENTIALS_REJECTED",
      retryable: false,
      merchant: "La cuenta de correo rechazó la credencial. Revisá el usuario y la contraseña de aplicación en Ajustes > Integraciones.",
    };
  }
  if (includesAny(hay, [/domain.*not verified/i, /from.*not verified/i, /sender.*not verified/i, /validation_error.*from/i])) {
    return {
      code: "EMAIL_SENDER_NOT_VERIFIED",
      retryable: false,
      merchant: "La dirección remitente todavía no está verificada. Revisá el email de origen en Ajustes > Integraciones.",
    };
  }
  if (source.providerStatus === 429 || includesAny(hay, [/rate[_ -]?limit/i, /too many requests/i, /429\b/i])) {
    return {
      code: "EMAIL_RATE_LIMITED",
      retryable: true,
      merchant: "El servicio de correo está procesando demasiados envíos. Esperá un minuto y volvé a intentar.",
    };
  }
  if (includesAny(hay, [/daily.*quota/i, /monthly.*quota/i, /quota.*exceed/i, /insufficient.*credits/i])) {
    return {
      code: "EMAIL_QUOTA_EXCEEDED",
      retryable: false,
      merchant: "La cuenta de correo alcanzó su límite de envíos. Revisá el plan de correo antes de reintentar.",
    };
  }
  if (includesAny(hay, [/recipient/i, /mailbox/i, /invalid.*email/i, /550\b/i, /suppressed/i, /bounc/i])) {
    return {
      code: "EMAIL_RECIPIENT_REJECTED",
      retryable: false,
      merchant: "La dirección destinataria fue rechazada. Verificá que el email esté bien escrito y activo.",
    };
  }
  if (includesAny(hay, [/certificate/i, /tls/i, /ssl/i, /handshake/i])) {
    return {
      code: "EMAIL_SECURE_CONNECTION_FAILED",
      retryable: false,
      merchant: "No se pudo establecer una conexión segura con la cuenta de correo. Revisá el puerto y la opción de conexión segura.",
    };
  }
  if (source.providerStatus !== undefined && source.providerStatus >= 500 || includesAny(hay, [/timeout/i, /timed out/i, /temporar/i, /connection reset/i, /unavailable/i])) {
    return {
      code: "EMAIL_PROVIDER_UNAVAILABLE",
      retryable: true,
      merchant: "El servicio de correo no respondió a tiempo. El contenido sigue guardado; volvé a intentar en unos minutos.",
    };
  }
  return {
    code: "EMAIL_DELIVERY_FAILED",
    retryable: source.retryable ?? false,
    merchant: "El correo no pudo enviarse. Revisá la dirección y la configuración de correo antes de volver a intentar.",
  };
}

export function emailFailure(
  source: EmailFailureSource,
  audience: EmailErrorAudience,
  context = "email",
): EmailFailureResponse {
  const item = classification(source);
  const reference = `mail-${crypto.randomUUID().slice(0, 8)}`;
  const publicMessage = "No pudimos enviar el correo en este momento. Tu operación sigue guardada y podés continuar.";
  const operatorMessage = [
    item.merchant,
    source.provider ? `Proveedor: ${source.provider}.` : "",
    source.providerStatus ? `HTTP: ${source.providerStatus}.` : "",
    source.providerCode ? `Código proveedor: ${source.providerCode}.` : "",
    source.error ? `Detalle: ${source.error}` : "",
  ].filter(Boolean).join(" ");

  console.error("email_delivery_failure", {
    reference,
    context,
    code: item.code,
    retryable: item.retryable,
    provider: source.provider,
    providerStatus: source.providerStatus,
    providerCode: source.providerCode,
    detail: source.error,
  });

  const visible = audience === "customer"
    ? publicMessage
    : audience === "platform"
    ? operatorMessage
    : item.merchant;

  return {
    ok: false,
    code: item.code,
    retryable: item.retryable,
    reference,
    error: `${visible} Referencia: ${reference}.`,
    public_message: publicMessage,
    merchant_message: item.merchant,
    ...(audience === "platform" ? {
      operator_message: operatorMessage,
      provider: source.provider ?? "none",
    } : {}),
  };
}
