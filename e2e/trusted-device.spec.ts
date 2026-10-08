import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

test.use({ serviceWorkers: "block" });
const USER_ID = "00000000-0000-4000-8000-000000000001";
const FACTOR_ID = "00000000-0000-4000-8000-000000000002";
const INITIAL_SESSION = "00000000-0000-4000-8000-000000000003";
const NEW_SESSION = "00000000-0000-4000-8000-000000000004";

// Synthetic UI evidence only: all Auth/DB/functions, realtime and cookie-API
// requests are intercepted. No live login, OTP verification, email or writes.
async function mockTrustedAccess(page: Page) {
  const url = process.env.VITE_SUPABASE_URL ?? "https://hummeopatkniwkyrrhwc.supabase.co";
  const storageKey = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  const state = {
    factor: true, remembered: false, expired: false, malformedReply: false,
    sessionId: INITIAL_SESSION, registerCalls: 0, challengeCalls: 0, verifyCalls: 0,
    passwordCalls: 0, redeemSessions: [] as string[],
  };
  const user = () => ({
    id: USER_ID, email: "zz-trusted-device@invalid.test", aud: "authenticated", role: "authenticated",
    created_at: "2026-10-04T00:00:00Z", app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: { full_name: "ZZ Dispositivo" }, identities: [],
    factors: state.factor ? [{ id: FACTOR_ID, factor_type: "totp", status: "verified", friendly_name: "ZZ TOTP" }] : [],
  });
  const session = (aal: "aal1" | "aal2") => {
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      sub: USER_ID, role: "authenticated", session_id: state.sessionId, iat: now, exp: now + 3600, aal,
      amr: [{ method: "password", timestamp: now }, ...(aal === "aal2" ? [{ method: "totp", timestamp: now }] : [])],
    };
    const access_token = [
      Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
      Buffer.from(JSON.stringify(claims)).toString("base64url"),
      Buffer.from("synthetic-ui-only-not-authenticated").toString("base64url"),
    ].join(".");
    return { access_token, refresh_token: "synthetic-ui-only", token_type: "bearer", expires_at: now + 3600, expires_in: 3600, user: user() };
  };
  await page.addInitScript(({ storageKey, fixture }) => {
    if (!localStorage.getItem(storageKey)) localStorage.setItem(storageKey, JSON.stringify(fixture));
  }, { storageKey, fixture: session("aal1") });
  // No connectToServer(): this is an intercepted local socket, not Supabase.
  await page.routeWebSocket(/wss:\/\/[^/]+\.supabase\.co\/.*/, socket => {
    socket.onMessage(message => {
      if (typeof message !== "string") return;
      try {
        const event = JSON.parse(message);
        if (Array.isArray(event)) socket.send(JSON.stringify([event[0], event[1], event[2], "phx_reply", { status: "ok", response: {} }]));
      } catch { /* Binary or unrelated messages are not a real provider call. */ }
    });
  });
  await page.route("**/*.supabase.co/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let result: unknown = [];
    if (path === "/auth/v1/user") result = user();
    else if (path === "/auth/v1/token") {
      state.passwordCalls++;
      state.sessionId = NEW_SESSION;
      result = session("aal1");
    } else if (path === `/auth/v1/factors/${FACTOR_ID}/challenge`) {
      state.challengeCalls++;
      result = { id: "00000000-0000-4000-8000-000000000005", type: "totp", expires_at: Math.floor(Date.now() / 1000) + 60 };
    } else if (path === `/auth/v1/factors/${FACTOR_ID}/verify`) {
      state.verifyCalls++;
      result = session("aal2");
    } else if (path === "/auth/v1/logout") {
      await route.fulfill({ status: 204, body: "" }); return;
    } else if (path === "/rest/v1/platform_admins") result = { user_id: USER_ID, role: "superadmin" };
    else if (path === "/rest/v1/memberships") result = [];
    else if (path === "/rest/v1/settings") result = [];
    else if (path === "/rest/v1/afip_platform_status") result = {
      configured: true, cuit: "20123456786", razon_social: "ZZ Plataforma", environment: "homologacion",
      ticket_vigente: true, ta_expires_at: "2099-01-01T00:00:00Z", comercios_delegados: 0,
      certificate_expires_at: "2099-01-01T00:00:00Z",
    };
    else if (path === "/rest/v1/platform_afip_delegation_queue") result = [];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(result) });
  });
  await page.route("**/api/trusted-device", async route => {
    const body = route.request().postDataJSON();
    let result: unknown = { trusted: false };
    const expiresAt = new Date(Date.now() + (state.expired ? -1000 : 7 * 86400000)).toISOString();
    if (body.action === "register") {
      state.registerCalls++;
      state.remembered = true;
      result = { trusted: true, expiresAt, currentDeviceId: FACTOR_ID };
    } else if (body.action === "redeem") {
      const jwt = route.request().headers().authorization?.split(" ")[1];
      const claims = jwt ? JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString()) : {};
      state.redeemSessions.push(claims.session_id);
      // Invalid transport shape exercises the gate's unavailable-service path
      // without generating an expected browser HTTP-error console message.
      result = state.malformedReply ? { code: "TRUST_UNAVAILABLE" }
        : state.remembered ? { trusted: true, expiresAt } : { trusted: false };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(result) });
  });
  return {
    state,
    replaceSession: async (factor = true) => {
      state.factor = factor;
      state.sessionId = NEW_SESSION;
      await page.evaluate(({ storageKey, fixture }) => localStorage.setItem(storageKey, JSON.stringify(fixture)), { storageKey, fixture: session("aal1") });
      await page.reload();
    },
  };
}

test("synthetic remembered browser: opt-in after TOTP and new password session without repeating OTP", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  const { state } = await mockTrustedAccess(page);
  await page.goto("/platform/afip");
  const gate = page.getByRole("heading", { name: "Verificación en dos pasos" });
  await expect(gate).toBeVisible();
  await expect(page.getByRole("heading", { name: "ARCA de la plataforma" })).toHaveCount(0);
  const remember = page.getByRole("checkbox", { name: "Recordar este navegador durante 7 días" });
  await expect(remember).not.toBeChecked();
  expect(state.registerCalls).toBe(0);

  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `gate overflow ${width}`).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`trusted-device-gate-${width}.png`), fullPage: true });
  }
  const violations = (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations
    .filter(violation => ["serious", "critical"].includes(violation.impact));
  expect(violations.map(violation => ({ id: violation.id, nodes: violation.nodes.map(node => node.failureSummary) }))).toEqual([]);
  await remember.check();
  await page.getByRole("textbox", { name: "Código de verificación" }).fill("123456");
  await page.getByRole("button", { name: "Verificar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "ARCA de la plataforma" })).toBeVisible();
  expect(state.registerCalls).toBe(1);
  expect(state.challengeCalls).toBe(1);
  expect(state.verifyCalls).toBe(1);

  // Exercise real logout/login UI against intercepted Auth, not a live account.
  await page.locator(".platform-topbar__actions button").click();
  await expect(page.getByRole("button", { name: "Entrar a Nerqia" })).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill("zz-trusted-device@invalid.test");
  await page.getByLabel("Contraseña", { exact: true }).fill("Synthetic-password-123");
  await page.getByRole("button", { name: "Entrar a Nerqia" }).click();
  await expect.poll(() => state.passwordCalls).toBe(1);
  await expect(page.getByRole("button", { name: "Entrar a Nerqia" })).toHaveCount(0);
  // Login navigates through the SPA into the platform home. Follow its AFIP
  // link instead of hard-reloading mid-auth; the browser must not abort the
  // session's in-flight user refresh while the remembered grant is redeemed.
  await page.getByRole("link", { name: "AFIP", exact: true }).click();
  await expect(page.getByRole("heading", { name: "ARCA de la plataforma" })).toBeVisible();
  await expect(gate).toHaveCount(0);
  expect(state.passwordCalls).toBe(1);
  expect(state.redeemSessions).toContain(NEW_SESSION);
  expect(state.verifyCalls).toBe(1);
  expect(state.registerCalls).toBe(1);
  expect(errors).toEqual([]);
});

test("synthetic remembered browser: expired/unavailable grants stay closed and missing factor requires enrollment", async ({ page }) => {
  test.setTimeout(45_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  const fixture = await mockTrustedAccess(page);
  fixture.state.remembered = true;
  fixture.state.expired = true;
  await page.goto("/platform/afip");
  await expect(page.getByRole("heading", { name: "Verificación en dos pasos" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "ARCA de la plataforma" })).toHaveCount(0);

  fixture.state.expired = false;
  fixture.state.malformedReply = true;
  await fixture.replaceSession();
  await expect(page.getByRole("heading", { name: "Verificación en dos pasos" })).toBeVisible();
  await expect(page.getByText("No pudimos comprobar el dispositivo recordado. Podés entrar con el código de tu app.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "ARCA de la plataforma" })).toHaveCount(0);

  fixture.state.malformedReply = false;
  await fixture.replaceSession(false);
  await expect(page.getByRole("heading", { name: "2FA obligatorio" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Configurar ahora" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Recordar este navegador durante 7 días" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "ARCA de la plataforma" })).toHaveCount(0);
  expect(fixture.state.registerCalls).toBe(0);
  expect(fixture.state.verifyCalls).toBe(0);
  expect(errors).toEqual([]);
});
