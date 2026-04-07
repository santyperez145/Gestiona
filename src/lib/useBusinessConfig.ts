import { useState, useEffect } from 'react';
import { getSettingsDB } from './supabaseStore';
import { useAuth } from './auth';

export type BusinessConfig = {
  businessName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
};

const defaultConfig: BusinessConfig = {
  businessName: 'Exentry Imports',
  logoUrl: null,
  primaryColor: '#D4A843',
  secondaryColor: '#1A1A2E',
};

const hexToHSL = (hex: string): string => {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
};

export function useBusinessConfig() {
  const { user } = useAuth();
  const [config, setConfig] = useState<BusinessConfig>(defaultConfig);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const s = await getSettingsDB(user.id) as any;
      setConfig({
        businessName: s.business_name || 'Exentry Imports',
        logoUrl: s.logo_url || null,
        primaryColor: s.primary_color || '#D4A843',
        secondaryColor: s.secondary_color || '#1A1A2E',
      });
    })();
  }, [user]);

  useEffect(() => {
    applyColors(config.primaryColor, config.secondaryColor);
  }, [config.primaryColor, config.secondaryColor]);

  return config;
}

export function applyColors(primaryHex: string, secondaryHex: string) {
  const root = document.documentElement;
  if (primaryHex && /^#[0-9A-Fa-f]{6}$/.test(primaryHex)) {
    const hsl = hexToHSL(primaryHex);
    root.style.setProperty('--primary', hsl);
    root.style.setProperty('--ring', hsl);
    root.style.setProperty('--sidebar-primary', hsl);
    root.style.setProperty('--sidebar-ring', hsl);
    root.style.setProperty('--accent', hsl);
  }
  if (secondaryHex && /^#[0-9A-Fa-f]{6}$/.test(secondaryHex)) {
    const hsl = hexToHSL(secondaryHex);
    root.style.setProperty('--background', hsl);
    root.style.setProperty('--sidebar-background', hsl);
    root.style.setProperty('--primary-foreground', hsl);
    root.style.setProperty('--sidebar-primary-foreground', hsl);
  }
}

  return config;
}
