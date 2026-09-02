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
  });

  it("docs de Google listan Redirect URLs para magic link y OAuth", () => {
    const doc = src("docs/GOOGLE_OAUTH_SETUP.md");
    expect(doc).toMatch(/Redirect URLs/i);
    expect(doc).toMatch(/localhost/);
    expect(doc).toMatch(/exentryimports\.vercel\.app|tudominio|Site URL/i);
  });
});
