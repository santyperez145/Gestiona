import { useState, useEffect } from 'react';
import { getSettingsDB } from './supabaseStore';
import { useAuth } from './auth';
import { esPerfilMenu, type PerfilMenu } from './navigation';

export type BusinessConfig = {
  businessName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  /** null = sin elegir: menú completo. Ver `apareceEnPerfil`. */
  perfilMenu: PerfilMenu | null;
};

const DEFAULT_LOGO: string | null = null;

const defaultConfig: BusinessConfig = {
  businessName: 'Nerqia',
  logoUrl: DEFAULT_LOGO,
  primaryColor: '#D4A843',
  secondaryColor: '#1A1A2E',
  perfilMenu: null,
};

export function useBusinessConfig() {
  const { user } = useAuth();
  const [config, setConfig] = useState<BusinessConfig>(defaultConfig);

  // Ajustes avisa cuando guarda: el menú cambia sin recargar la página.
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const releer = () => setVersion(v => v + 1);
    window.addEventListener('nerqia:ajustes-guardados', releer);
    return () => window.removeEventListener('nerqia:ajustes-guardados', releer);
  }, []);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const s = await getSettingsDB(user.id);
      setConfig({
        businessName: s.business_name || 'Nerqia',
        logoUrl: s.logo_url || DEFAULT_LOGO,
        primaryColor: s.primary_color || '#D4A843',
        secondaryColor: s.secondary_color || '#1A1A2E',
        // `perfil_menu` llega con 20261010001400; los tipos generados todavía no la tienen.
        perfilMenu: (() => { const p = (s as { perfil_menu?: unknown }).perfil_menu; return esPerfilMenu(p) ? p : null; })(),
      });
    })();
  }, [user, version]);

  return config;
}
