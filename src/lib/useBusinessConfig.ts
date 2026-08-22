import { useState, useEffect } from 'react';
import { getSettingsDB } from './supabaseStore';
import { useAuth } from './auth';

export type BusinessConfig = {
  businessName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
};

const DEFAULT_LOGO = '/exentry-logo.png';

const defaultConfig: BusinessConfig = {
  businessName: 'Gestiona',
  logoUrl: DEFAULT_LOGO,
  primaryColor: '#D4A843',
  secondaryColor: '#1A1A2E',
};

export function useBusinessConfig() {
  const { user } = useAuth();
  const [config, setConfig] = useState<BusinessConfig>(defaultConfig);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const s = await getSettingsDB(user.id);
      setConfig({
        businessName: s.business_name || 'Gestiona',
        logoUrl: s.logo_url || DEFAULT_LOGO,
        primaryColor: s.primary_color || '#D4A843',
        secondaryColor: s.secondary_color || '#1A1A2E',
      });
    })();
  }, [user]);

  return config;
}
