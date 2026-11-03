import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const src = (rel: string) => readFileSync(join(root, rel), "utf8");

describe("auth email OTP / magic link (SaaS)", () => {
  it("AuthProvider expone OTP sin crear usuario en login", () => {
    const auth = src("src/lib/auth.tsx");
    expect(auth).toContain("signInWithEmailOtp");
    expect(auth).toContain("verifyEmailOtp");
    expect(auth).toContain("signInWithOtp");
    expect(auth).toContain("shouldCreateUser: false");
    expect(auth).toContain("type: 'email'");
    expect(auth).toContain("authEmailRedirectTo");
  });

  it("AuthPage ofrece enlace/código y no inventa WhatsApp login", () => {
    const page = src("src/pages/AuthPage.tsx");
    expect(page).toContain("Entrar con enlace o código");
    expect(page).toContain("signInWithEmailOtp");
    expect(page).toContain("verifyEmailOtp");
    expect(page).toMatch(/whatsapp_listo|WhatsApp todavía no está disponible/i);
    expect(page).not.toMatch(/signInWithOtp\(\s*\{\s*phone/i);
    // 2026-11-03: el aviso de WhatsApp y el código de un solo uso aparecían
    // también en el alta, donde no aplican.
    expect(page).toMatch(/\{mode === 'login' && \(\s*<p className="auth-channel-note"/);
    expect(page).toMatch(/mode === 'login'\s*\? 'Entrá de forma segura con tu email y contraseña, o con un código de un solo uso\.'/);
  });

  it("el registro habla en castellano y no saluda «de vuelta» al que entra por primera vez", () => {
    const page = src("src/pages/AuthPage.tsx");
    // 2026-11-03: «Commerce Operating System», «Finance» y «CRM genérico»
    // eran jerga en inglés en la primera pantalla de una persona nueva.
    expect(page).not.toContain("<Store /> Commerce Operating System");
    expect(page).not.toContain("Commerce OS</span>");
    expect(page).not.toContain("CRM genérico más");
    expect(page).not.toContain("gestión y finance");
    expect(page).not.toContain("toast.success('¡Bienvenido de vuelta!')");
    expect(page).toContain("toast.success('¡Hola! Ya entraste a Nerqia.')");
    // El E2E del alta usa estos textos tal cual.
    expect(page).toContain("'Crear mi cuenta gratis'");
    expect(page).toContain("'Entrar a Nerqia'");
  });

  it("docs de Google listan Redirect URLs para magic link y OAuth", () => {
    const doc = src("docs/GOOGLE_OAUTH_SETUP.md");
    expect(doc).toMatch(/Redirect URLs/i);
    expect(doc).toMatch(/localhost/);
    expect(doc).toMatch(/exentryimports\.vercel\.app|tudominio|Site URL/i);
  });
});
