-- ============================================================================
-- Bloque 3 — Limpieza: dropear tablas de features eliminadas del producto
--
-- Estas tablas pertenecen a módulos que se removieron en la refocalización
-- (RRHH/payroll, e-learning, eventos, turnos, alquileres, gamificación, flota,
-- proyectos, forms, gift cards, dropshipping, marketplace, NPS, SLA, warranty,
-- customer journey, ESG/carbono, revenue recognition enterprise, digital
-- products).
--
-- Se verificó que NINGÚN código mantenido (src/** ni supabase/functions/**) las
-- referencia. Se EXCLUYEN a propósito las tablas que sí siguen en uso tras las
-- fusiones: competitor_prices, ocr_documents, dynamic_price_rules,
-- dynamic_price_events, demand_signals.
--
-- DESTRUCTIVO e irreversible: borra los datos de esas tablas. Como los módulos
-- ya no existen en la app, no hay pérdida funcional. CASCADE limpia índices,
-- policies y FKs dependientes.
-- ============================================================================

-- NPS / encuestas
DROP TABLE IF EXISTS public.nps_responses CASCADE;
DROP TABLE IF EXISTS public.nps_surveys CASCADE;

-- SLA / escalaciones
DROP TABLE IF EXISTS public.sla_ticket_assignments CASCADE;
DROP TABLE IF EXISTS public.sla_breaches CASCADE;
DROP TABLE IF EXISTS public.escalation_rules CASCADE;
DROP TABLE IF EXISTS public.sla_policies CASCADE;

-- Timesheets / payroll / RRHH
DROP TABLE IF EXISTS public.payroll_entries CASCADE;
DROP TABLE IF EXISTS public.payroll_items CASCADE;
DROP TABLE IF EXISTS public.payroll_periods CASCADE;
DROP TABLE IF EXISTS public.timesheets CASCADE;
DROP TABLE IF EXISTS public.leave_requests CASCADE;
DROP TABLE IF EXISTS public.leave_types CASCADE;
DROP TABLE IF EXISTS public.performance_reviews CASCADE;
DROP TABLE IF EXISTS public.employee_documents CASCADE;
DROP TABLE IF EXISTS public.employees CASCADE;

-- Eventos / ticketing
DROP TABLE IF EXISTS public.event_attendees CASCADE;
DROP TABLE IF EXISTS public.ticket_types CASCADE;
DROP TABLE IF EXISTS public.events CASCADE;

-- Turnos / reservas
DROP TABLE IF EXISTS public.appointment_blocks CASCADE;
DROP TABLE IF EXISTS public.appointments CASCADE;
DROP TABLE IF EXISTS public.staff_availability CASCADE;
DROP TABLE IF EXISTS public.services CASCADE;

-- Productos digitales
DROP TABLE IF EXISTS public.digital_download_events CASCADE;
DROP TABLE IF EXISTS public.digital_product_licenses CASCADE;
DROP TABLE IF EXISTS public.digital_products CASCADE;

-- Gamificación (staff)
DROP TABLE IF EXISTS public.point_transactions CASCADE;
DROP TABLE IF EXISTS public.staff_badge_awards CASCADE;
DROP TABLE IF EXISTS public.staff_points CASCADE;
DROP TABLE IF EXISTS public.badge_definitions CASCADE;

-- Gamificación de ventas
DROP TABLE IF EXISTS public.gamification_events CASCADE;
DROP TABLE IF EXISTS public.gamification_challenges CASCADE;
DROP TABLE IF EXISTS public.gamification_badges CASCADE;
DROP TABLE IF EXISTS public.gamification_profiles CASCADE;
DROP TABLE IF EXISTS public.gamification_config CASCADE;

-- Garantías / reparaciones
DROP TABLE IF EXISTS public.warranty_events CASCADE;
DROP TABLE IF EXISTS public.warranty_claims CASCADE;

-- Constructor de forms
DROP TABLE IF EXISTS public.form_responses CASCADE;
DROP TABLE IF EXISTS public.custom_forms CASCADE;

-- Alquileres
DROP TABLE IF EXISTS public.rental_payments CASCADE;
DROP TABLE IF EXISTS public.rental_contracts CASCADE;
DROP TABLE IF EXISTS public.rental_assets CASCADE;

-- Marketplace listings
DROP TABLE IF EXISTS public.marketplace_orders CASCADE;
DROP TABLE IF EXISTS public.marketplace_listings CASCADE;
DROP TABLE IF EXISTS public.marketplace_channels CASCADE;

-- Gestión de proyectos
DROP TABLE IF EXISTS public.project_expenses CASCADE;
DROP TABLE IF EXISTS public.project_time_logs CASCADE;
DROP TABLE IF EXISTS public.project_tasks CASCADE;
DROP TABLE IF EXISTS public.project_milestones CASCADE;
DROP TABLE IF EXISTS public.projects CASCADE;

-- Gift cards
DROP TABLE IF EXISTS public.gift_card_transactions CASCADE;
DROP TABLE IF EXISTS public.gift_cards CASCADE;

-- Dropshipping
DROP TABLE IF EXISTS public.dropship_order_items CASCADE;
DROP TABLE IF EXISTS public.dropship_orders CASCADE;
DROP TABLE IF EXISTS public.dropship_products CASCADE;
DROP TABLE IF EXISTS public.dropship_suppliers CASCADE;

-- Flota vehicular
DROP TABLE IF EXISTS public.vehicle_trips CASCADE;
DROP TABLE IF EXISTS public.vehicle_fuel_logs CASCADE;
DROP TABLE IF EXISTS public.vehicle_maintenance CASCADE;
DROP TABLE IF EXISTS public.vehicles CASCADE;

-- Control de mermas
DROP TABLE IF EXISTS public.waste_records CASCADE;
DROP TABLE IF EXISTS public.waste_categories CASCADE;

-- Customer journey
DROP TABLE IF EXISTS public.journey_automations CASCADE;
DROP TABLE IF EXISTS public.customer_journey_assignments CASCADE;
DROP TABLE IF EXISTS public.customer_touchpoints CASCADE;
DROP TABLE IF EXISTS public.journey_stages CASCADE;

-- E-learning
DROP TABLE IF EXISTS public.learning_module_progress CASCADE;
DROP TABLE IF EXISTS public.learning_enrollments CASCADE;
DROP TABLE IF EXISTS public.learning_quiz_questions CASCADE;
DROP TABLE IF EXISTS public.learning_modules CASCADE;
DROP TABLE IF EXISTS public.learning_courses CASCADE;

-- Revenue recognition (enterprise)
DROP TABLE IF EXISTS public.revenue_journal_entries CASCADE;
DROP TABLE IF EXISTS public.performance_obligations CASCADE;
DROP TABLE IF EXISTS public.revenue_contracts CASCADE;

-- Huella de carbono / ESG
DROP TABLE IF EXISTS public.carbon_offsets CASCADE;
DROP TABLE IF EXISTS public.carbon_targets CASCADE;
DROP TABLE IF EXISTS public.carbon_emissions CASCADE;
DROP TABLE IF EXISTS public.carbon_emission_categories CASCADE;

-- Funciones seed de gamificación de ventas (ya no aplican)
DROP FUNCTION IF EXISTS public.seed_gamification_badges(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.seed_gamification_config(uuid) CASCADE;
