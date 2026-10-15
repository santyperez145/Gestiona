/**
 * check-alerts — Alertas inteligentes por organización
 *
 * Corre todos los días (o a pedido desde la pantalla). Por cada negocio con
 * reglas activas arma **un aviso por regla** (2026-10-15):
 *   stock_low         → productos activos con stock <= threshold_value
 *   low_margin        → productos activos con margen% < threshold_value
 *   debt_overdue      → deudas vencidas hace más de threshold_days días
 *   customer_inactive → clientes que compraron y no volvieron en threshold_days
 *   high_expense      → gastos del mes > threshold_value (ARS)
 *   product_expiry    → productos con stock vencidos o por vencer
 *   stale_price       → precios desviados del dólar actual
 *
 * Antes era un aviso por cliente o producto: una corrida del 14/10 dejó 51
 * sin leer en Exentry, y un cliente que nunca compró figuraba «inactivo». Cada
 * resumen guarda la pantalla donde se resuelve (`entity_type = 'ruta'`): si ya
 * hay uno sin leer de la misma regla se actualiza en vez de sumar otro, y uno
 * leído en las últimas 24 h no se repite.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

import { exigirCronOUsuario } from "../_shared/cronAuth.ts";
import { leerPaginado } from "../_shared/leerPaginado.ts";
import {
  resumirClientesInactivos, resumirDeudasVencidas, resumirMargenBajo,
  resumirStockBajo, resumirVencimientos, type Resumen,
} from "../_shared/resumenDeAlertas.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const TOPE = 50_000;
const DIA_AR = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit",
});
const diaAR = (d: Date) => DIA_AR.format(d);

// deno-lint-ignore no-explicit-any
async function todas(armar: (q: any) => any, tabla: string, columnas: string): Promise<Record<string, unknown>[]> {
  const { rows, error } = await leerPaginado(
    (desde, hasta) => armar(supabase.from(tabla).select(columnas)).order("id").range(desde, hasta),
    TOPE,
  );
  if (error) throw new Error(`no se pudo leer (${columnas}): ${(error as { message?: string }).message ?? error.code}`);
  return rows;
}

type Aviso = Resumen & { type: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*" } });
  }

  // Sólo el cron de la base o una persona con sesión real.
  const noEsCron = await exigirCronOUsuario(req, { "Access-Control-Allow-Origin": "*" });
  if (noEsCron) return noEsCron;

  try {
    const { data: rules, error: rulesErr } = await supabase
      .from("alert_rules")
      .select("*")
      .eq("enabled", true);
    if (rulesErr) throw rulesErr;

    const orgIds = [...new Set((rules ?? []).map((r: any) => r.org_id))];
    let totalAlerts = 0;
    let totalActualizados = 0;
    const now = new Date();
    const hoy = diaAR(now);

    for (const orgId of orgIds) {
      const orgRules: any[] = (rules ?? []).filter((r: any) => r.org_id === orgId);
      const alerts: Aviso[] = [];
      const sumar = (type: string, r: Resumen | null) => { if (r) alerts.push({ ...r, type }); };

      for (const rule of orgRules) {
        if (rule.type === "stock_low") {
          const prods = await todas(
            q => q.eq("org_id", orgId).lte("stock", rule.threshold_value).gt("stock", -1),
            "products", "id, name, stock, is_active",
          );
          sumar("stock_bajo", resumirStockBajo(prods as any[], Number(rule.threshold_value)));
        }

        if (rule.type === "low_margin") {
          const prods = await todas(
            q => q.eq("org_id", orgId).gt("sale_price_ars", 0),
            "products", "id, name, sale_price_ars, profit_per_unit_ars, is_active",
          );
          sumar("sistema", resumirMargenBajo(prods as any[], Number(rule.threshold_value)));
        }

        if (rule.type === "debt_overdue") {
          const cutoff = new Date(now.getTime() - Number(rule.threshold_days) * 86_400_000);
          // ⚠️ `debts` no tiene `paid` ni `amount` (es `status` y
          // `remaining_ars`): con esos nombres la consulta fallaba, el error no
          // se miraba y la alerta de deuda vencida no salió nunca (medido
          // 2026-10-11). Un fallo corta la corrida en vez de callarse.
          let deudas: Record<string, unknown>[];
          try {
            deudas = await todas(
              q => q.eq("org_id", orgId)
                .in("status", ["pending", "partial"])
                .gt("remaining_ars", 0)
                .lte("due_date", diaAR(cutoff)),
              "debts", "id, customer_name, remaining_ars, due_date",
            );
          } catch (errDeudas) {
            throw new Error(`no se pudieron leer las deudas: ${(errDeudas as Error).message}`);
          }
          sumar("deuda_vencida", resumirDeudasVencidas(deudas as any[], now));
        }

        if (rule.type === "customer_inactive") {
          const clientes = await todas(q => q.eq("org_id", orgId), "customers", "id, name");
          const ventas = await todas(q => q.eq("org_id", orgId), "sales", "id, customer_id, customer_name, date, total_ars");
          sumar("sistema", resumirClientesInactivos(clientes as any[], ventas as any[], Number(rule.threshold_days), now));
        }

        if (rule.type === "high_expense") {
          const firstOfMonth = `${hoy.slice(0, 7)}-01`;
          const { data: expenses, error: errGastos } = await supabase
            .from("expenses")
            .select("amount_ars")
            .eq("org_id", orgId)
            .gte("date", firstOfMonth);
          if (errGastos) throw new Error(`no se pudieron leer los gastos: ${errGastos.message}`);

          const total = (expenses ?? []).reduce(
            (s: number, e: any) => s + Number(e.amount_ars || 0), 0
          );
          if (total > rule.threshold_value) {
            alerts.push({
              type: "sistema",
              title: "Gastos elevados este mes",
              message: `Total gastos: $${total.toLocaleString("es-AR")} (umbral: $${Number(rule.threshold_value).toLocaleString("es-AR")}).`,
              url: "/gastos",
            });
          }
        }

        if (rule.type === "product_expiry") {
          const cutoffStr = diaAR(new Date(now.getTime() + Number(rule.threshold_days) * 86_400_000));
          const prods = await todas(
            q => q.eq("org_id", orgId).gt("stock", 0)
              .not("expiry_date", "is", null).lte("expiry_date", cutoffStr),
            "products", "id, name, expiry_date, stock",
          );
          sumar("sistema", resumirVencimientos(prods as any[], hoy));
        }

        if (rule.type === "stale_price") {
          // Precio desactualizado: el precio guardado se desvió más de
          // threshold_value % del que correspondería hoy.
          // Fórmula espejo de src/lib/pricing.ts (calcAutoSalePrice):
          //   (costo + costo×recargo%) × TC × markup de la categoría
          const { data: settingsRow } = await supabase
            .from("settings")
            .select("exchange_rate, customs_percent, category_pricing")
            .eq("org_id", orgId)
            .maybeSingle();

          const rate = Number(settingsRow?.exchange_rate) || 0;
          const customs = Number(settingsRow?.customs_percent) || 0;
          const catPricing = (settingsRow?.category_pricing ?? {}) as Record<string, { markup?: number }>;
          const tolerance = Number(rule.threshold_value) || 10;

          if (rate > 0) {
            const prods = await todas(
              q => q.eq("org_id", orgId).gt("cost_usd", 0).gt("sale_price_ars", 0),
              "products", "id, name, category, cost_usd, sale_price_ars, is_active",
            );

            const stale: { name: string; actual: number; expected: number; devPct: number }[] = [];
            for (const p of prods as any[]) {
              if (p.is_active === false) continue;
              const mk = Number(catPricing?.[p.category as string]?.markup) > 0
                ? Number(catPricing[p.category as string].markup)
                : 2;
              const cost = Number(p.cost_usd);
              const expected = Math.round((cost + cost * (customs / 100)) * rate * mk);
              if (expected <= 0) continue;
              const actual = Number(p.sale_price_ars);
              const devPct = Math.abs(actual - expected) / expected * 100;
              if (devPct > tolerance) stale.push({ name: p.name, actual, expected, devPct });
            }

            if (stale.length > 0) {
              stale.sort((a, b) => b.devPct - a.devPct);
              const worst = stale[0];
              const fmt = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;
              alerts.push({
                type: "sistema",
                title: `${stale.length} producto${stale.length !== 1 ? "s" : ""} con precio desactualizado`,
                message:
                  `El precio guardado difiere más de ${tolerance}% del que corresponde al dólar actual ($${rate}). ` +
                  `El más desviado: ${worst.name} — está a ${fmt(worst.actual)} y debería estar a ${fmt(worst.expected)} ` +
                  `(${worst.devPct.toFixed(0)}% de desvío). Podés corregirlos con "Recalcular Todo" en Ajustes.`,
                url: "/ajustes",
              });
            }
          }
        }

        const { error: corridaErr } = await supabase
          .from("alert_rules")
          .update({ last_run_at: now.toISOString() })
          .eq("id", rule.id);
        if (corridaErr) console.error("check-alerts: no se guardó last_run_at", rule.id, corridaErr);
      }

      if (alerts.length === 0) continue;

      const { data: members, error: errMiembros } = await supabase
        .from("memberships")
        .select("user_id")
        .eq("org_id", orgId)
        // ⚠️ El dueño también. Acá decía `.eq("role","admin")`, así que en un
        // comercio de una sola persona —todo comercio nuevo— la lista quedaba
        // vacía y no se mandaba **ninguna** alerta.
        .in("role", ["owner", "admin"]);
      if (errMiembros) throw new Error(`no se pudieron leer los administradores: ${errMiembros.message}`);

      const adminIds = (members ?? []).map((m: any) => m.user_id);
      if (adminIds.length === 0) continue;

      // Un resumen por regla y persona: el sin leer se actualiza, el leído en
      // las últimas 24 h no se repite. La clave es la pantalla del resumen.
      const cutoff24h = new Date(now.getTime() - 86_400_000).toISOString();
      const rutas = [...new Set(alerts.map(a => a.url))];
      const { data: previas, error: errPrevias } = await supabase
        .from("notifications")
        .select("id, user_id, entity_id, read")
        .eq("org_id", orgId)
        .eq("entity_type", "ruta")
        .in("user_id", adminIds)
        .in("entity_id", rutas)
        .or(`read.eq.false,created_at.gte.${cutoff24h}`);
      if (errPrevias) throw new Error(`no se pudieron leer los avisos previos: ${errPrevias.message}`);

      const sinLeer = new Map<string, string>();
      const recientes = new Set<string>();
      for (const n of previas ?? []) {
        const clave = `${n.user_id}|${n.entity_id}`;
        if (!n.read) sinLeer.set(clave, n.id);
        recientes.add(clave);
      }

      const toInsert: any[] = [];
      let actualizados = 0;
      for (const adminId of adminIds) {
        for (const alert of alerts) {
          const clave = `${adminId}|${alert.url}`;
          const previa = sinLeer.get(clave);
          if (previa) {
            const { error: errAct } = await supabase
              .from("notifications")
              .update({ title: alert.title, message: alert.message, type: alert.type })
              .eq("id", previa);
            if (errAct) console.error("check-alerts: no se actualizó el aviso", previa, errAct);
            else actualizados++;
            continue;
          }
          if (recientes.has(clave)) continue;
          toInsert.push({
            // ⚠️ `notifications.org_id` es NOT NULL: sin él cada insert fallaba
            // con 23502 (medido el 2026-08-28).
            org_id: orgId,
            user_id: adminId,
            type: alert.type,
            title: alert.title,
            message: alert.message,
            entity_type: "ruta",
            entity_id: alert.url,
            read: false,
          });
        }
      }

      if (toInsert.length > 0) {
        // ⚠️ Se mira el error y sólo se cuenta lo que se escribió: una función
        // que dice ok sin haber escrito es peor que una que falla.
        const { error: errNotif } = await supabase
          .from("notifications").insert(toInsert);
        if (errNotif) {
          console.error("check-alerts: no se pudieron crear las notificaciones", errNotif);
        } else {
          totalAlerts += toInsert.length;
        }

        const { error: disparoErr } = await supabase
          .from("alert_rules")
          .update({ last_triggered_at: now.toISOString() })
          .eq("org_id", orgId)
          .eq("enabled", true);
        if (disparoErr) console.error("check-alerts: no se guardó last_triggered_at", orgId, disparoErr);

        // Push con lo nuevo, no con lo que sólo se actualizó.
        const nuevos = alerts.filter(a => toInsert.some(n => n.entity_id === a.url));
        const pushTitle = nuevos.length === 1 ? nuevos[0].title : `${nuevos.length} alertas nuevas`;
        const pushBody = nuevos.length === 1 ? nuevos[0].message : nuevos.slice(0, 3).map(a => a.title).join(" · ");
        try {
          const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
          await fetch(`${supabaseUrl}/functions/v1/send-push`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            },
            body: JSON.stringify({ org_id: orgId, title: pushTitle, body: pushBody, url: nuevos.length === 1 ? nuevos[0].url : "/alertas", tag: "gestiona-alerts" }),
          });
        } catch (pushErr) {
          console.warn("check-alerts: push notification failed", pushErr);
        }
      }
      totalActualizados += actualizados;
    }

    return new Response(
      JSON.stringify({ ok: true, notifications_created: totalAlerts, notifications_updated: totalActualizados, orgs_checked: orgIds.length }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("check-alerts error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
