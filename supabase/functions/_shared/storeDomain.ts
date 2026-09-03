const LABEL = /^(?:[a-z0-9]|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9]))$/;
const PUBLIC_SUFFIX = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/;

export function validateStoreDomainServer(value: unknown): {
  domain: string;
  valid: boolean;
  error?: string;
} {
  const domain = String(value ?? '').trim().toLowerCase().replace(/\.$/, '');
  if (!domain) return { domain, valid: false, error: 'Ingresá un dominio.' };
  if (domain.length > 253 || domain.includes('://') || /[/:?#@\s]/.test(domain)) {
    return { domain, valid: false, error: 'Escribí sólo el dominio, sin protocolo, rutas ni puertos.' };
  }
  const labels = domain.split('.');
  if (labels.length < 2 || labels.some(label => !LABEL.test(label))) {
    return { domain, valid: false, error: 'El dominio no tiene un formato válido.' };
  }
  if (!PUBLIC_SUFFIX.test(labels.at(-1) ?? '')) {
    return { domain, valid: false, error: 'Usá un dominio público válido.' };
  }
  if (
    domain === 'nerqia.app' || domain.endsWith('.nerqia.app')
    || domain === 'vercel.app' || domain.endsWith('.vercel.app')
  ) {
    return { domain, valid: false, error: 'Ese dominio está reservado por la plataforma.' };
  }
  return { domain, valid: true };
}

export interface VercelProjectDomain {
  name?: string;
  apexName?: string;
  verified?: boolean;
  verification?: Array<{ type?: string; domain?: string; value?: string; reason?: string }>;
}

export interface VercelDomainConfig {
  configuredBy?: string | null;
  acceptedChallenges?: string[];
  recommendedIPv4?: Array<{ rank?: number; value?: string[] }>;
  recommendedCNAME?: Array<{ rank?: number; value?: string }>;
  misconfigured?: boolean;
}

function preferred<T extends { rank?: number }>(values: T[] | undefined): T | null {
  return [...(values ?? [])].sort((a, b) => Number(a.rank ?? 99) - Number(b.rank ?? 99))[0] ?? null;
}

export function sanitizedStoreDomainState(
  domain: string,
  projectDomain: VercelProjectDomain,
  config: VercelDomainConfig,
) {
  const records: Array<{ type: 'TXT' | 'A' | 'CNAME'; name: string; value: string; purpose: 'ownership' | 'routing' }> = [];
  for (const challenge of projectDomain.verification ?? []) {
    if (String(challenge.type).toUpperCase() !== 'TXT' || !challenge.domain || !challenge.value) continue;
    records.push({
      type: 'TXT',
      name: String(challenge.domain),
      value: String(challenge.value),
      purpose: 'ownership',
    });
  }

  const apex = String(projectDomain.apexName ?? domain).toLowerCase();
  if (domain === apex) {
    const recommendation = preferred(config.recommendedIPv4);
    const value = recommendation?.value?.[0];
    if (value) records.push({ type: 'A', name: '@', value, purpose: 'routing' });
  } else {
    const recommendation = preferred(config.recommendedCNAME);
    if (recommendation?.value) {
      records.push({ type: 'CNAME', name: domain, value: recommendation.value, purpose: 'routing' });
    }
  }

  const verified = projectDomain.verified === true;
  const misconfigured = config.misconfigured === true;
  const configuredBy = config.configuredBy ?? null;
  const status = !verified
    ? 'pending_verification'
    : !misconfigured
      ? 'active'
      : configuredBy == null
        ? 'pending_dns'
        : 'misconfigured';

  return {
    status,
    verification: {
      provider: 'vercel',
      attached: true,
      verified,
      misconfigured,
      configuredBy,
      acceptedChallenges: (config.acceptedChallenges ?? []).filter(value => typeof value === 'string'),
      records,
    },
  };
}
