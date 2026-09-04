import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type StoreTrackingConsent = "granted" | "denied" | null;

const STORAGE_PREFIX = "nerqia.store-tracking-consent.v1.";

export function storeTrackingConsentKey(slug: string) {
  return `${STORAGE_PREFIX}${slug.trim().toLowerCase()}`;
}

export function readStoreTrackingConsent(
  storage: Pick<Storage, "getItem">,
  slug: string,
): StoreTrackingConsent {
  try {
    const value = storage.getItem(storeTrackingConsentKey(slug));
    return value === "granted" || value === "denied" ? value : null;
  } catch {
    return null;
  }
}

export function writeStoreTrackingConsent(
  storage: Pick<Storage, "setItem">,
  slug: string,
  value: Exclude<StoreTrackingConsent, null>,
) {
  try {
    storage.setItem(storeTrackingConsentKey(slug), value);
    return true;
  } catch {
    return false;
  }
}

interface StoreTrackingConsentValue {
  decision: StoreTrackingConsent;
  disabled: boolean;
  choose: (value: Exclude<StoreTrackingConsent, null>) => void;
}

const Context = createContext<StoreTrackingConsentValue>({
  decision: null,
  disabled: false,
  choose: () => {},
});

const RuntimeContext = createContext(false);

export function StoreTrackingConsentProvider({
  slug,
  disabled = false,
  children,
}: {
  slug: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  const [decision, setDecision] = useState<StoreTrackingConsent>(() => (
    disabled || typeof window === "undefined" ? (disabled ? "denied" : null) : readStoreTrackingConsent(window.localStorage, slug)
  ));

  useEffect(() => {
    if (disabled) {
      setDecision("denied");
      return;
    }
    setDecision(readStoreTrackingConsent(window.localStorage, slug));
    const key = storeTrackingConsentKey(slug);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== key) return;
      setDecision(event.newValue === "granted" || event.newValue === "denied" ? event.newValue : null);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [disabled, slug]);

  const choose = useCallback((value: Exclude<StoreTrackingConsent, null>) => {
    if (disabled) return;
    writeStoreTrackingConsent(window.localStorage, slug, value);
    setDecision(value);
  }, [disabled, slug]);

  const value = useMemo(() => ({ decision, disabled, choose }), [decision, disabled, choose]);
  return createElement(Context.Provider, { value }, children);
}

export function useStoreTrackingConsent() {
  return useContext(Context);
}

/**
 * Señala que los destinos activos corresponden a la tienda visible. Separarlo
 * de la decisión evita que un efecto hijo emita antes de que el padre cambie
 * los IDs al navegar entre merchants dentro de la misma SPA.
 */
export function StoreTrackingRuntimeProvider({
  ready,
  children,
}: {
  ready: boolean;
  children: ReactNode;
}) {
  return createElement(RuntimeContext.Provider, { value: ready }, children);
}

export function useStoreTrackingRuntimeReady() {
  return useContext(RuntimeContext);
}
