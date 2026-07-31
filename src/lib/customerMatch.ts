/**
 * Cruzar filas del CRM con un cliente.
 *
 * `sales`, `debts` y `loyalty_points` tienen `customer_id`, resuelto por
 * trigger. Cuando está, manda: "Juan Perez", "juan perez" y "Juan  Perez" son
 * la misma persona, y renombrar a alguien ya no le borra el historial.
 *
 * Pero **no alcanza con leer sólo por id**. Las filas de gente que todavía no
 * está cargada en el CRM quedan con `customer_id` nulo, y no hay trigger que
 * las enlace cuando después se la da de alta. Si se leyera sólo por id, dar de
 * alta a un comprador viejo mostraría su ficha vacía teniendo compras. Por eso
 * la fila sin enlazar se cruza por nombre normalizado, que es lo que se hacía
 * antes y sigue siendo lo mejor disponible para ese caso.
 *
 * `normalizeName` es espejo de `public.normalize_person_name`
 * (`20260731000016_sales_customer_id.sql`). Si se toca una, se toca la otra:
 * si divergen, el cliente ve un historial en la ficha y otro en los totales.
 */

const ACENTOS = "áàäâãéèëêíìïîóòöôõúùüûñç";
const LLANOS = "aaaaaeeeeiiiiooooouuuunc";

/**
 * Minúsculas, sin acentos y con los espacios colapsados.
 * Devuelve `null` para lo que no identifica a nadie, así dos nombres vacíos
 * nunca "coinciden" entre sí.
 */
export function normalizeName(name: string | null | undefined): string | null {
  if (!name) return null;
  let out = "";
  for (const ch of name.toLowerCase()) {
    const i = ACENTOS.indexOf(ch);
    out += i >= 0 ? LLANOS[i] : ch;
  }
  out = out.replace(/\s+/g, " ").trim();
  return out === "" ? null : out;
}

/** Lo mínimo que se necesita de un cliente para cruzarlo. */
export interface CustomerRef {
  id?: string | null;
  name?: string | null;
}

/** Lo mínimo que se necesita de una fila del CRM. */
export interface CustomerLinkedRow {
  customer_id?: string | null;
  customer_name?: string | null;
}

/**
 * ¿Esta fila es de este cliente?
 *
 * Con `customer_id` decide el id y nada más — una fila enlazada a otro cliente
 * no vuelve por la ventana del nombre aunque se llamen igual.
 */
export function belongsToCustomer(row: CustomerLinkedRow, customer: CustomerRef): boolean {
  if (row.customer_id) return !!customer.id && row.customer_id === customer.id;
  const n = normalizeName(row.customer_name);
  return n !== null && n === normalizeName(customer.name);
}

/** Filtra las filas de un cliente. Azúcar sobre `belongsToCustomer`. */
export function rowsOfCustomer<T extends CustomerLinkedRow>(rows: T[], customer: CustomerRef): T[] {
  return rows.filter(r => belongsToCustomer(r, customer));
}
