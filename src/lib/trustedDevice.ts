import { supabase } from "@/integrations/supabase/client";

export type TrustedDeviceAction = "register" | "redeem" | "status" | "list" | "revoke" | "revoke_all";
export interface TrustedDevice {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
}
export interface TrustedDeviceResult {
  trusted: boolean;
  expiresAt?: string;
  currentDeviceId?: string;
  devices?: TrustedDevice[];
}

const messages: Record<string, string> = {
  AUTH_REQUIRED: "Tu sesión venció. Volvé a iniciar sesión.",
  MFA_REQUIRED: "Verificá un código nuevo de tu app de autenticación para continuar.",
  PASSWORD_REQUIRED: "Para recordar este navegador, ingresá con tu correo y contraseña.",
  ORIGIN_NOT_ALLOWED: "El acceso recordado sólo está disponible en nerqia.app.",
  RATE_LIMITED: "Se realizaron demasiados intentos. Esperá unos minutos y reintentá.",
  DEVICE_LIMIT: "Revocá algún navegador recordado antes de agregar otro.",
};
export class TrustedDeviceError extends Error {
  constructor(public code: string, public status = 503) {
    super(messages[code] ?? "No pudimos comprobar el dispositivo recordado. Podés entrar con el código de tu app.");
    this.name = "TrustedDeviceError";
  }
}

export function canRememberDevice(): boolean {
  return typeof window !== "undefined" && /^https?:$/.test(window.location.protocol);
}

/** No credential is written to JS storage; the endpoint owns the HttpOnly cookie. */
export async function trustedDeviceCommand(action: TrustedDeviceAction, deviceId?: string): Promise<TrustedDeviceResult> {
  if (!canRememberDevice()) throw new TrustedDeviceError("ORIGIN_NOT_ALLOWED", 403);
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new TrustedDeviceError("AUTH_REQUIRED", 401);
  let response: Response;
  try {
    response = await fetch("/api/trusted-device", {
      method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
      body: JSON.stringify({ action, ...(deviceId ? { deviceId } : {}) }),
      signal: AbortSignal.timeout(15000),
    });
  } catch { throw new TrustedDeviceError("TRUST_UNAVAILABLE"); }
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || typeof body.trusted !== "boolean") {
    throw new TrustedDeviceError(typeof body?.code === "string" ? body.code : "TRUST_UNAVAILABLE", response.status);
  }
  if (["register", "revoke", "revoke_all"].includes(action)) {
    window.dispatchEvent(new Event("nerqia:trusted-device-changed"));
  }
  return body as TrustedDeviceResult;
}
