import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  authRedirectTo,
  completeNativeAuthCallback,
  isNativeRuntime,
  nativeAuthCustomerMessage,
  parseNativeAuthCallback,
} from '@/lib/nativeRuntime';

function setNative(enabled: boolean) {
  if (enabled) {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    });
  } else {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  }
}

afterEach(() => setNative(false));

describe('runtime nativo Nerqia', () => {
  it('mantiene redirect HTTPS en web y usa deep link registrado en la app', () => {
    expect(isNativeRuntime()).toBe(false);
    expect(authRedirectTo('/reset-password')).toBe(`${window.location.origin}/reset-password`);

    setNative(true);
    expect(isNativeRuntime()).toBe(true);
    expect(authRedirectTo('/reset-password')).toBe('nerqia://auth/callback?next=%2Freset-password');
  });

  it('acepta sólo el callback propio y conserva el código PKCE', () => {
    const callback = parseNativeAuthCallback(
      'nerqia://auth/callback?next=%2F&code=abc&sb_flow_id=flow-1',
    );
    expect(callback).toMatchObject({
      code: 'abc',
      recovery: false,
      destination: '/',
    });

    expect(() => parseNativeAuthCallback('https://evil.example/callback?code=abc')).toThrow('fuera de alcance');
    expect(() => parseNativeAuthCallback('nerqia://auth/otro?code=abc')).toThrow('fuera de alcance');
  });

  it('completa recuperación PKCE y nunca confía en un next externo', async () => {
    const exchangeCodeForSession = vi.fn().mockResolvedValue({ data: {}, error: null });
    const callback = await completeNativeAuthCallback(
      'nerqia://auth/callback?next=https%3A%2F%2Fevil.example&code=recovery-code&type=recovery',
      { auth: { exchangeCodeForSession } } as any,
    );

    expect(exchangeCodeForSession).toHaveBeenCalledWith('recovery-code');
    expect(callback.recovery).toBe(true);
    expect(callback.destination).toBe('/reset-password');
  });

  it('admite el hash legado sólo con ambos tokens y traduce errores al cliente', () => {
    expect(parseNativeAuthCallback(
      'nerqia://auth/callback#access_token=access&refresh_token=refresh&type=recovery',
    )).toMatchObject({ accessToken: 'access', refreshToken: 'refresh', recovery: true });
    expect(() => parseNativeAuthCallback(
      'nerqia://auth/callback#access_token=access',
    )).toThrow('no contiene una sesión');
    expect(nativeAuthCustomerMessage('cancelled')).not.toContain('access_denied');
    expect(nativeAuthCustomerMessage('expired')).toContain('venció');
  });
});
