-- El saldo a favor no es plata que entra (2026-10-30).
--
-- Medido revisando el asiento de una venta pagada con saldo a favor:
-- `cuenta_de_cobro` no conocía el medio `saldo_a_favor`.
--   · La de 1 argumento (pedidos online y mostrador) devolvía NULL y el
--     asiento del pedido caía en «MercadoPago a liquidar» (1.1.03): una plata
--     de Mercado Pago que nunca iba a llegar, y la conciliación no cerraba.
--   · La de 2 argumentos (ventas) caía en Caja (1.1.01): la caja del balance
--     contaba dos veces el mismo efectivo.
-- El saldo a favor nace cuando la plata ya entró (un anticipo cobrado en la
-- caja) o cuando el comercio da crédito por una devolución. Usarlo no mueve
-- plata: aplica ese crédito. Con este plan de cuentas eso es «Deudores por
-- ventas» (1.2.01), como el fiado y la cuenta corriente: se cancela contra el
-- crédito del cliente, nunca contra Caja ni Mercado Pago.
--
-- Mismas firmas y mismo comportamiento para todo lo demás (las dos conviven a
-- propósito: ver src/test/unaFuncionUnaFirma.test.ts). Reversible: las
-- definiciones de 20260821000040 y 20260826000260.

BEGIN;

CREATE OR REPLACE FUNCTION public.cuenta_de_cobro(p_metodo text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT CASE lower(btrim(COALESCE(p_metodo, '')))
    WHEN 'efectivo'         THEN '1.1.01'
    WHEN 'cash'             THEN '1.1.01'
    WHEN 'transferencia'    THEN '1.1.02'
    WHEN 'deposito'         THEN '1.1.02'
    -- Tarjeta y billetera entran como valores a liquidar: la plata todavía no
    -- está disponible y la comisión aparece recién en la liquidación.
    WHEN 'mercado_pago'     THEN '1.1.03'
    WHEN 'mercadopago'      THEN '1.1.03'
    WHEN 'credito'          THEN '1.1.03'
    WHEN 'debito'           THEN '1.1.03'
    WHEN 'tarjeta'          THEN '1.1.03'
    WHEN 'qr'               THEN '1.1.03'
    WHEN 'modo'             THEN '1.1.03'
    -- Fiado no es plata: es un crédito contra el cliente.
    WHEN 'fiado'            THEN '1.2.01'
    WHEN 'cuenta_corriente' THEN '1.2.01'
    -- Usar saldo a favor tampoco: aplica un crédito que el cliente ya tenía.
    WHEN 'saldo_a_favor'    THEN '1.2.01'
    ELSE NULL
  END;
$fn$;

COMMENT ON FUNCTION public.cuenta_de_cobro(text) IS
  'Metodo de cobro -> cuenta del plan. Unica fuente: la usan el consumidor de ordenes online y el de ventas de mostrador. NULL = metodo desconocido, y quien llama tiene que dejar rastro. saldo_a_favor va a Deudores por ventas (20261030000800).';

CREATE OR REPLACE FUNCTION public.cuenta_de_cobro(p_metodo text, p_paid boolean)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT CASE
    -- Una venta no cobrada es un crédito, sea cual sea el medio previsto.
    WHEN COALESCE(p_paid, true) IS FALSE THEN '1.2.01'
    WHEN p_metodo = 'efectivo'      THEN '1.1.01'
    WHEN p_metodo = 'transferencia' THEN '1.1.02'
    WHEN p_metodo = 'credito'       THEN '1.1.02'
    WHEN p_metodo = 'mercado_pago'  THEN '1.1.03'
    WHEN p_metodo = 'fiado'         THEN '1.2.01'
    -- Pagar con saldo a favor no entra a Caja: aplica el crédito del cliente.
    WHEN p_metodo = 'saldo_a_favor' THEN '1.2.01'
    -- Sin dato de dónde entró: Caja, y se expone en la vista de sin clasificar.
    ELSE '1.1.01'
  END;
$fn$;

COMMENT ON FUNCTION public.cuenta_de_cobro(text, boolean) IS
  'Cuenta contable donde cae el cobro de una venta segun el medio. Afecta el balance, no el resultado. Lo que no mapea va a Caja y se expone en ventas_con_cobro_sin_clasificar. saldo_a_favor va a Deudores por ventas (20261030000800).';

COMMIT;
