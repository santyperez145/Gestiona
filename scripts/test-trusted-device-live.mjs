/**
 * Explicit, temporary live Auth + trusted-device integration drill.
 *
 * AdminCreateUser confirms a random example.invalid store_customer without
 * sending mail. The TOTP secret, password, JWT and device credential stay in
 * process memory; neither provider responses nor secrets are printed.
 *
 * Required environment (set outside shell history):
 *   NERQIA_AUTH_LIVE_TEST=approved
 *   SUPABASE_URL=https://hummeopatkniwkyrrhwc.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=...    # server-side test runner only
 *   SUPABASE_ANON_KEY=...
 * Optional after first-party deployment: NERQIA_AUTH_PROXY_ORIGIN=https://nerqia.app
 */
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_ORIGIN = 'https://hummeopatkniwkyrrhwc.supabase.co';
const PROXY_ORIGIN = 'https://nerqia.app';
const COOKIE_NAME = '__Host-nerqia-mfa-device';
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let checkpoint = 'preflight';
let interrupted = false;
let cleaningUp = false;
process.on('SIGINT', () => { interrupted = true; });
process.on('SIGTERM', () => { interrupted = true; });

function requireStep(condition, label) {
  if (!condition || (interrupted && !cleaningUp)) throw new Error(label);
}

function mark(label, status) {
  checkpoint = label;
  if (interrupted && !cleaningUp) throw new Error(label);
  console.log(`CHECK ${label}${status === undefined ? '' : ` HTTP ${status}`}`);
}

function decodeJwt(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function fromBase32(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const normalized = value.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let buffer = 0;
  const bytes = [];
  for (const character of normalized) {
    const digit = alphabet.indexOf(character);
    requireStep(digit >= 0, 'totp_secret_format');
    buffer = (buffer << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 0xff);
    }
  }
  requireStep(bytes.length >= 10, 'totp_secret_format');
  return Buffer.from(bytes);
}

function totp(secret, offsetSteps = 0) {
  const counter = BigInt(Math.floor(Date.now() / 30_000) + offsetSteps);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = createHmac('sha1', secret).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

function secretFreeFetch(origin) {
  return async (input, init = {}) => {
    const target = new URL(typeof input === 'string' ? input
      : input instanceof URL ? input.href : input.url);
    requireStep(target.origin === origin, 'request_scope');
    const signal = AbortSignal.any([
      AbortSignal.timeout(15_000),
      ...(init.signal ? [init.signal] : []),
    ]);
    return fetch(input, { ...init, redirect: 'error', signal });
  };
}

function makeClient(url, key) {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: secretFreeFetch(url) },
  });
}

function preflight() {
  const env = process.env;
  requireStep(env.NERQIA_AUTH_LIVE_TEST === 'approved', 'approval_required');
  requireStep(env.SUPABASE_URL === SUPABASE_ORIGIN, 'project_scope');
  requireStep(typeof env.SUPABASE_SERVICE_ROLE_KEY === 'string' && env.SUPABASE_SERVICE_ROLE_KEY.length > 30,
    'service_key_required');
  requireStep(typeof env.SUPABASE_ANON_KEY === 'string' && env.SUPABASE_ANON_KEY.length > 20,
    'anon_key_required');
  requireStep(!env.NERQIA_AUTH_PROXY_ORIGIN || env.NERQIA_AUTH_PROXY_ORIGIN === PROXY_ORIGIN,
    'proxy_scope');
  return {
    url: SUPABASE_ORIGIN,
    adminKey: env.SUPABASE_SERVICE_ROLE_KEY,
    anonKey: env.SUPABASE_ANON_KEY,
    proxy: env.NERQIA_AUTH_PROXY_ORIGIN === PROXY_ORIGIN,
  };
}

class Transport {
  constructor(config) {
    this.config = config;
    this.cookie = null;
    this.deviceToken = null;
  }

  rememberCookie(response) {
    const raw = response.headers.get('set-cookie');
    if (!raw) return false;
    const first = raw.split(';', 1)[0];
    requireStep(first.startsWith(`${COOKIE_NAME}=`), 'cookie_name');
    const value = first.slice(COOKIE_NAME.length + 1);
    if (!value) {
      this.cookie = null;
      return true;
    }
    requireStep(TOKEN_RE.test(value) && Buffer.from(value, 'base64url').length === 32,
      'cookie_entropy');
    requireStep(/;\s*HttpOnly(?:;|$)/i.test(raw) && /;\s*Secure(?:;|$)/i.test(raw)
      && /;\s*SameSite=Strict(?:;|$)/i.test(raw) && /;\s*Path=\/(?:;|$)/i.test(raw),
    'cookie_attributes');
    this.cookie = `${COOKIE_NAME}=${value}`;
    return true;
  }

  async command(action, accessToken, extra = {}) {
    const proxy = this.config.proxy;
    const url = proxy
      ? `${PROXY_ORIGIN}/api/trusted-device`
      : `${this.config.url}/functions/v1/trusted-device`;
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(proxy
        ? { Origin: PROXY_ORIGIN, 'Sec-Fetch-Site': 'same-origin', ...(this.cookie ? { Cookie: this.cookie } : {}) }
        : { apikey: this.config.anonKey }),
    };
    const body = proxy
      ? { action, ...(extra.deviceId ? { deviceId: extra.deviceId } : {}) }
      : {
          action,
          ...(extra.deviceId ? { deviceId: extra.deviceId } : {}),
          ...(extra.label ? { label: extra.label } : {}),
          ...(this.deviceToken ? { token: this.deviceToken } : {}),
        };
    const response = await fetch(url, {
      method: 'POST', headers, body: JSON.stringify(body),
      redirect: 'error', signal: AbortSignal.timeout(15_000),
    });
    let data = null;
    try { data = await response.json(); } catch { /* static failure below */ }
    requireStep(data && typeof data === 'object' && !Array.isArray(data), `transport_${action}_json`);
    if (proxy) {
      requireStep(!Object.hasOwn(data, 'token') && !Object.hasOwn(data, 'token_hash'),
        `proxy_${action}_secret_boundary`);
      this.rememberCookie(response);
    }
    mark(`transport_${action}`, response.status);
    requireStep(response.ok, `transport_${action}_http`);
    if (action === 'register' && !proxy) {
      requireStep(typeof data.token === 'string' && TOKEN_RE.test(data.token)
        && Buffer.from(data.token, 'base64url').length === 32, 'device_token_entropy');
      this.deviceToken = data.token;
    }
    return data;
  }

  allowed(data) {
    return this.config.proxy ? data.trusted === true : data.allowed === true;
  }

  expiry(data) {
    return this.config.proxy ? data.expiresAt : data.expires_at;
  }

  deviceId(data) {
    return this.config.proxy ? data.currentDeviceId : data.device_id;
  }
}

async function verifyTotp(client, factorId, secret) {
  for (const offset of [0, -1, 1]) {
    checkpoint = 'totp_challenge';
    const { data: challenge, error: challengeError } = await client.auth.mfa.challenge({ factorId });
    requireStep(!challengeError && typeof challenge?.id === 'string', 'totp_challenge');
    checkpoint = 'totp_verify';
    const { data, error } = await client.auth.mfa.verify({
      factorId, challengeId: challenge.id, code: totp(secret, offset),
    });
    if (!error && data?.access_token) {
      const claims = decodeJwt(data.access_token);
      requireStep(claims?.aal === 'aal2' && Array.isArray(claims.amr)
        && claims.amr.some(item => ['totp', 'mfa/totp'].includes(item.method)), 'totp_aal2');
      mark('totp_aal2');
      return data.access_token;
    }
  }
  throw new Error('totp_verify');
}

async function countOwnRows(admin, table, column, userId) {
  const { count, error } = await admin.from(table).select('*', { count: 'exact', head: true }).eq(column, userId);
  requireStep(!error && Number.isInteger(count), `count_${table}`);
  return count;
}

async function run() {
  const config = preflight();
  const admin = makeClient(config.url, config.adminKey);
  const userClient = makeClient(config.url, config.anonKey);
  const transport = new Transport(config);
  let userId = randomUUID();
  const email = `zz-trusted-live-${randomBytes(10).toString('hex')}@example.invalid`;
  const password = `${randomBytes(24).toString('base64url')}!aA1`;
  const newPassword = `${randomBytes(24).toString('base64url')}!bB2`;
  let creationAttempted = false;
  let failure = null;
  let cleanupFailed = false;
  let totpKey = null;

  try {
    checkpoint = 'admin_create';
    creationAttempted = true;
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      id: userId, email, password, email_confirm: true,
      user_metadata: { account_type: 'store_customer', full_name: 'ZZ trusted device live smoke' },
    });
    // Some Auth versions may allocate their own UUID. Only adopt a returned
    // ID if both the unpredictable fixture email and metadata bind it to our
    // request; cleanup must never delete a different user's returned ID.
    if (created?.user?.email === email
      && created.user.user_metadata?.account_type === 'store_customer'
      && UUID_RE.test(created.user.id)) userId = created.user.id;
    requireStep(!createError && created?.user?.id === userId
      && created.user.email === email
      && created.user.user_metadata?.account_type === 'store_customer', 'admin_create');
    mark('admin_create');

    checkpoint = 'customer_scope';
    requireStep(await countOwnRows(admin, 'profiles', 'user_id', userId) === 1, 'profile_created');
    requireStep(await countOwnRows(admin, 'memberships', 'user_id', userId) === 0, 'no_organization');
    mark('customer_scope');

    checkpoint = 'password_login_1';
    const { data: login1, error: loginError1 } = await userClient.auth.signInWithPassword({ email, password });
    requireStep(!loginError1 && typeof login1?.session?.access_token === 'string', 'password_login_1');
    const claims1 = decodeJwt(login1.session.access_token);
    requireStep(claims1?.aal === 'aal1' && UUID_RE.test(claims1.session_id), 'aal1_session_1');
    mark('password_login_1');

    checkpoint = 'totp_enroll';
    const { data: enrollment, error: enrollError } = await userClient.auth.mfa.enroll({
      factorType: 'totp', friendlyName: 'ZZ live trust smoke',
    });
    requireStep(!enrollError && UUID_RE.test(enrollment?.id)
      && typeof enrollment?.totp?.secret === 'string', 'totp_enroll');
    const factorId = enrollment.id;
    totpKey = fromBase32(enrollment.totp.secret);
    mark('totp_enroll');

    const aal2Token = await verifyTotp(userClient, factorId, totpKey);
    checkpoint = 'register';
    const registered = await transport.command('register', aal2Token, { label: 'ZZ live smoke browser' });
    requireStep(transport.allowed(registered) && Number.isFinite(Date.parse(transport.expiry(registered))),
      'register');
    const firstExpiry = transport.expiry(registered);
    const firstDevice = transport.deviceId(registered);
    requireStep(UUID_RE.test(firstDevice), 'registered_device_id');
    if (config.proxy) requireStep(Boolean(transport.cookie), 'register_cookie');
    mark('register');

    checkpoint = 'local_logout';
    const { error: signOutError } = await userClient.auth.signOut({ scope: 'local' });
    requireStep(!signOutError, 'local_logout');
    mark('local_logout');

    checkpoint = 'password_login_2';
    const { data: login2, error: loginError2 } = await userClient.auth.signInWithPassword({ email, password });
    requireStep(!loginError2 && typeof login2?.session?.access_token === 'string', 'password_login_2');
    const aal1Token = login2.session.access_token;
    const claims2 = decodeJwt(aal1Token);
    requireStep(claims2?.aal === 'aal1' && UUID_RE.test(claims2.session_id)
      && claims2.session_id !== claims1.session_id
      && claims2.amr?.some(item => item.method === 'password'), 'new_password_session');
    mark('password_login_2');

    checkpoint = 'redeem';
    const redeemed = await transport.command('redeem', aal1Token);
    requireStep(transport.allowed(redeemed) && transport.expiry(redeemed) === firstExpiry,
      'fixed_expiry_redeem');
    const afterRedeem = decodeJwt(aal1Token);
    requireStep(afterRedeem?.aal === 'aal1', 'no_fake_aal2');
    const { data: mfaStatus, error: mfaStatusError } = await userClient.rpc('get_session_mfa_status');
    requireStep(!mfaStatusError && mfaStatus?.satisfied === true && mfaStatus?.aal2 === false,
      'server_grant_without_aal2');
    mark('redeem');

    const status = await transport.command('status', aal1Token);
    requireStep(transport.allowed(status) && transport.expiry(status) === firstExpiry,
      'trusted_status');
    const list = await transport.command('list', aal1Token);
    requireStep(transport.allowed(list) && transport.deviceId(list) === firstDevice
      && Array.isArray(list.devices) && list.devices.some(item => item.id === firstDevice),
    'device_list');
    mark('status_list');

    checkpoint = 'revoke';
    const revoked = await transport.command('revoke', aal1Token);
    requireStep(config.proxy ? revoked.trusted === false && transport.cookie === null
      : revoked.revoked === true, 'revoke');
    const afterRevoke = await transport.command('status', aal1Token);
    requireStep(!transport.allowed(afterRevoke), 'revoked_status');
    const { data: revokedMfa, error: revokedMfaError } = await userClient.rpc('get_session_mfa_status');
    requireStep(!revokedMfaError && revokedMfa?.satisfied === false, 'revoked_grant');
    mark('revoke');

    checkpoint = 'totp_reverify';
    const aal2Again = await verifyTotp(userClient, factorId, totpKey);
    const registeredAgain = await transport.command('register', aal2Again,
      { label: 'ZZ live smoke password rotation' });
    requireStep(transport.allowed(registeredAgain), 'register_before_password_change');
    mark('register_before_password_change');

    checkpoint = 'password_change';
    const { error: updateError } = await admin.auth.admin.updateUserById(userId, { password: newPassword });
    requireStep(!updateError, 'password_change');
    const postChangeClient = makeClient(config.url, config.anonKey);
    const { data: login3, error: loginError3 } = await postChangeClient.auth.signInWithPassword({
      email, password: newPassword,
    });
    requireStep(!loginError3 && decodeJwt(login3?.session?.access_token)?.aal === 'aal1',
      'password_change_login');
    const afterChange = await transport.command('redeem', login3.session.access_token);
    requireStep(!transport.allowed(afterChange), 'password_change_revokes_trust');
    mark('password_change_revokes_trust');
  } catch {
    failure = checkpoint;
  } finally {
    totpKey?.fill(0);
    cleaningUp = true;
    if (creationAttempted) {
      checkpoint = 'cleanup';
      try {
        // The caller chose the UUID, so an ambiguous create response can still
        // be cleaned up without enumerating Auth users or exposing an email.
        await admin.auth.admin.deleteUser(userId, false);
        const { data: lookup, error: lookupError } = await admin.auth.admin.getUserById(userId);
        requireStep(!lookup?.user && Boolean(lookupError), 'cleanup_auth_absent');
        requireStep(await countOwnRows(admin, 'profiles', 'user_id', userId) === 0,
          'cleanup_profile_cascade');
        requireStep(await countOwnRows(admin, 'memberships', 'user_id', userId) === 0,
          'cleanup_no_membership');
        mark('cleanup_verified');
      } catch {
        cleanupFailed = true;
      }
    }
  }
  if (interrupted) failure ??= 'interrupted';
  if (failure || cleanupFailed) {
    console.error(`FAIL ${failure ?? 'integration'} cleanup=${cleanupFailed ? 'unverified' : 'verified'}`);
    process.exitCode = 1;
    return;
  }
  console.log(`PASS trusted-device-live mode=${config.proxy ? 'proxy' : 'edge'} cleanup=verified`);
}

try {
  await run();
} catch {
  // Never print provider errors, URLs, request bodies, JWTs or stack traces.
  console.error(`FAIL ${checkpoint}`);
  process.exitCode = 1;
}
