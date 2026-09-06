import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  authErrorForCustomer,
  checkPassword,
  MIN_PASSWORD_LENGTH,
  passwordValidationMessage,
} from '@/lib/passwordSecurity';

const ROOT = process.cwd();
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

describe('política única de contraseña', () => {
  it('exige longitud, mayúscula, minúscula y número', () => {
    expect(MIN_PASSWORD_LENGTH).toBeGreaterThanOrEqual(10);
    expect(checkPassword('larga-pero-sin-numero').valid).toBe(false);
    expect(checkPassword('Nerqia2026Segura').valid).toBe(true);
    expect(passwordValidationMessage('corta1A')).toContain(String(MIN_PASSWORD_LENGTH));
  });

  it('no expone mensajes internos del proveedor al cliente', () => {
    expect(authErrorForCustomer({ message: 'Invalid login credentials', code: 'invalid_credentials' }))
      .toBe('El email o la contraseña no son correctos.');
    expect(authErrorForCustomer({ message: 'postgres relation auth.users failed' }))
      .not.toContain('postgres');
  });
});

describe('ciclo de recuperación y cambio', () => {
  const auth = read('src/lib/auth.tsx');
  const login = read('src/pages/AuthPage.tsx');
  const reset = read('src/pages/ResetPasswordPage.tsx');
  const profile = read('src/pages/ProfilePage.tsx');
  const config = read('supabase/config.toml');

  it('centraliza la solicitud y no revela si la cuenta existe', () => {
    expect(auth).toContain('requestPasswordReset');
    expect(login).toContain('Si existe una cuenta con ese email');
    expect(login).not.toContain('docs/GOOGLE_OAUTH_SETUP.md');
  });

  it('acepta recuperación PKCE o hash sólo con sesión válida', () => {
    expect(auth).toContain("event === 'PASSWORD_RECOVERY'");
    expect(reset).toContain("new URLSearchParams(window.location.search).has('code')");
    expect(reset).toContain('Boolean(session && (passwordRecovery || linkSignalsRecovery))');
  });

  it('reautentica cambios iniciados desde perfil y cierra otras sesiones', () => {
    expect(profile).toContain('signInWithPassword');
    expect(profile).toContain("signOut({ scope: 'others' })");
    expect(reset).toContain("signOut({ scope: 'others' })");
    expect(config).toContain('secure_password_change = true');
  });
});
