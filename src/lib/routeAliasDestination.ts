/** Carry only explicitly allowed filters; never propagate tokens or override the destination view. */
export function routeAliasDestination(destination: string, search: string, preserve: readonly string[] = []) {
  if (preserve.length === 0) return destination;
  const target = new URL(destination, "https://nerqia.app");
  const incoming = new URLSearchParams(search);
  for (const key of preserve) {
    const value = incoming.get(key);
    if (value !== null && !target.searchParams.has(key)) target.searchParams.set(key, value);
  }
  return `${target.pathname}${target.search}${target.hash}`;
}
