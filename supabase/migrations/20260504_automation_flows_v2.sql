-- Expand automation_flows to support more trigger and action types
-- Drops the old CHECK constraints and replaces with wider ones.

alter table public.automation_flows
  drop constraint if exists automation_flows_trigger_type_check;

alter table public.automation_flows
  drop constraint if exists automation_flows_action_type_check;

alter table public.automation_flows
  add constraint automation_flows_trigger_type_check
    check (trigger_type in (
      'customer_inactive',
      'debt_overdue',
      'low_stock',
      'birthday',
      'stock_out',
      'new_customer',
      'big_sale'
    ));

alter table public.automation_flows
  add constraint automation_flows_action_type_check
    check (action_type in (
      'notification',
      'email',
      'whatsapp_message',
      'create_task',
      'create_purchase_order',
      'webhook'
    ));
