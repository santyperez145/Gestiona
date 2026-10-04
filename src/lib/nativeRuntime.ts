import type { SupabaseClient } from '@supabase/supabase-js';

export const NATIVE_AUTH_CALLBACK = 'nerqia://auth/callback';

const NATIVE_DESTINATIONS = new Set(['/', '/reset-password']);

type TauriWindow = Window & { __TAURI_INTERNALS__?: unknown };

export type NativeAuthCallback = {
  code: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  recovery: boolean;
  destination: '/' | '/reset-password';
  providerError: string | null;
};

export class NativeAuthCallbackError extends Error {
  constructor(
    public readonly customerCode: 'cancelled' | 'expired' | 'invalid' | 'session',
    message: string,
  ) {
    super(message);
    this.name = 'NativeAuthCallbackError';
  }
}

export function isNativeRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in (window as TauriWindow);
}

function safeDestination(value: string | null | undefined): '/' | '/reset-password' {
  return value && NATIVE_DESTINATIONS.has(value) ? value as '/' | '/reset-password' : '/';
}

/** Redirect de Auth compartido: HTTPS en web y protocolo registrado en la app. */
export function authRedirectTo(destination: '/' | '/reset-password' = '/'): string {
  if (!isNativeRuntime()) return `${window.location.origin}${destination}`;
  const callback = new URL(NATIVE_AUTH_CALLBACK);
  callback.searchParams.set('next', destination);
  return callback.toString();
}

function combinedParams(url: URL): URLSearchParams {
  const params = new URLSearchParams(url.search);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  hash.forEach((value, key) => {
    if (!params.has(key)) params.set(key, value);
  });
  return params;
}

/**
 * Rechaza protocolos, hosts y rutas inesperados antes de entregar tokens a
 * Supabase. Un deep link es input controlado por el usuario, no confianza.
 */
export function parseNativeAuthCallback(value: string): NativeAuthCallback {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new NativeAuthCallbackError('invalid', 'Deep link inválido');
  }
  if (url.protocol !== 'nerqia:' || url.hostname !== 'auth' || url.pathname !== '/callback') {
    throw new NativeAuthCallbackError('invalid', 'Callback nativo fuera de alcance');
  }

  const params = combinedParams(url);
  const providerError = params.get('error');
  const description = params.get('error_description') ?? providerError;
  if (providerError) {
    const cancelled = /access_denied|cancel/i.test(`${providerError} ${description ?? ''}`);
    throw new NativeAuthCallbackError(cancelled ? 'cancelled' : 'session', description ?? 'Proveedor rechazó el acceso');
  }

  const code = params.get('code');
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!code && !(accessToken && refreshToken)) {
    throw new NativeAuthCallbackError('expired', 'El enlace no contiene una sesión intercambiable');
  }

  const recovery = params.get('type') === 'recovery'
    || params.get('next') === '/reset-password';

  return {
    code,
    accessToken,
    refreshToken,
    recovery,
    destination: recovery ? '/reset-password' : safeDestination(params.get('next')),
    providerError,
  };
}

export async function completeNativeAuthCallback(
  value: string,
  client: Pick<SupabaseClient, 'auth'>,
): Promise<NativeAuthCallback> {
  const callback = parseNativeAuthCallback(value);
  const result = callback.code
    ? await client.auth.exchangeCodeForSession(callback.code)
    : await client.auth.setSession({
        access_token: callback.accessToken!,
        refresh_token: callback.refreshToken!,
      });

  if (result.error) {
    throw new NativeAuthCallbackError('session', result.error.message);
  }
  return callback;
}

/** Abre OAuth en el navegador del sistema; nunca incrusta credenciales. */
export async function openNativeAuthUrl(value: string): Promise<void> {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co')) {
    throw new Error('Destino OAuth no permitido');
  }
  if (!isNativeRuntime()) {
    window.location.assign(url.toString());
    return;
  }
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  await openUrl(url.toString());
}

/** Escucha tanto arranque frío como callbacks recibidos con la app abierta. */
export async function listenForNativeAuthCallbacks(
  onUrl: (url: string) => void | Promise<void>,
): Promise<() => void> {
  if (!isNativeRuntime()) return () => undefined;
  const { getCurrent, onOpenUrl } = await import('@tauri-apps/plugin-deep-link');
  const unlisten = await onOpenUrl((urls) => {
    for (const url of urls) void onUrl(url);
  });
  const current = await getCurrent();
  for (const url of current ?? []) void onUrl(url);
  return unlisten;
}

export function nativeAuthCustomerMessage(code: string | null): string {
  if (code === 'cancelled') return 'Cancelaste el acceso. Podés intentarlo de nuevo cuando quieras.';
  if (code === 'expired') return 'El enlace venció o ya fue usado. Solicitá uno nuevo.';
  return 'No pudimos completar el acceso seguro. Intentá nuevamente.';
}
