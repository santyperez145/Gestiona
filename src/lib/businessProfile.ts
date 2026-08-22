import { supabase } from '@/integrations/supabase/client';
import type { Database, Json } from '@/integrations/supabase/types';
import type { ActivationGoal } from '@/lib/activationReadiness';

export type BusinessProfilePreset = Database['public']['Tables']['industry_presets']['Row'];
export type OrganizationBusinessProfile = Database['public']['Tables']['organization_business_profiles']['Row'];

export interface BusinessProfileAttributeTemplate {
  name: string;
  slug: string;
  dataType: 'text' | 'number' | 'boolean' | 'date' | 'select' | 'multiselect';
  unit: string | null;
  options: string[];
  required: boolean;
  filterable: boolean;
}

export interface BusinessProfileProductTypeTemplate {
  name: string;
  slug: string;
  description: string | null;
  attributes: BusinessProfileAttributeTemplate[];
}

export interface BusinessProfileApplication {
  orgId: string;
  industryCode: string;
  profileVersion: number;
  typesCreated: number;
  attributesCreated: number;
  customConflicts: number;
}

export interface BusinessProfileSummary {
  typeCount: number;
  attributeCount: number;
  typeNames: string[];
  attributeNames: string[];
}

const ATTRIBUTE_TYPES = new Set<BusinessProfileAttributeTemplate['dataType']>([
  'text', 'number', 'boolean', 'date', 'select', 'multiselect',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function parseProductTypeTemplates(value: Json | null | undefined): BusinessProfileProductTypeTemplate[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((rawType) => {
    if (!isRecord(rawType)) return [];
    const name = stringValue(rawType.name);
    const slug = stringValue(rawType.slug);
    if (!name || !slug || !Array.isArray(rawType.attributes)) return [];

    const attributes = rawType.attributes.flatMap((rawAttribute) => {
      if (!isRecord(rawAttribute)) return [];
      const attributeName = stringValue(rawAttribute.name);
      const attributeSlug = stringValue(rawAttribute.slug);
      const rawDataType = stringValue(rawAttribute.data_type);
      if (!attributeName || !attributeSlug || !rawDataType || !ATTRIBUTE_TYPES.has(rawDataType as BusinessProfileAttributeTemplate['dataType'])) {
        return [];
      }
      const options = Array.isArray(rawAttribute.options)
        ? rawAttribute.options.filter((option): option is string => typeof option === 'string' && Boolean(option.trim())).map(option => option.trim())
        : [];

      return [{
        name: attributeName,
        slug: attributeSlug,
        dataType: rawDataType as BusinessProfileAttributeTemplate['dataType'],
        unit: stringValue(rawAttribute.unit),
        options,
        required: booleanValue(rawAttribute.required, false),
        filterable: booleanValue(rawAttribute.filterable, true),
      }];
    });

    return [{
      name,
      slug,
      description: stringValue(rawType.description),
      attributes,
    }];
  });
}

export function summarizeBusinessProfile(templates: BusinessProfileProductTypeTemplate[]): BusinessProfileSummary {
  return {
    typeCount: templates.length,
    attributeCount: templates.reduce((total, template) => total + template.attributes.length, 0),
    typeNames: templates.map(template => template.name),
    attributeNames: templates.flatMap(template => template.attributes.map(attribute => attribute.name)),
  };
}

function parseApplication(value: Json): BusinessProfileApplication {
  if (!isRecord(value)) throw new Error('El servidor devolvio un perfil de negocio invalido');
  const orgId = stringValue(value.org_id);
  const industryCode = stringValue(value.industry_code);
  const profileVersion = Number(value.profile_version);
  const typesCreated = Number(value.types_created);
  const attributesCreated = Number(value.attributes_created);
  const customConflicts = Number(value.custom_conflicts);
  if (!orgId || !industryCode || ![profileVersion, typesCreated, attributesCreated, customConflicts].every(Number.isFinite)) {
    throw new Error('El servidor devolvio un perfil de negocio incompleto');
  }
  return { orgId, industryCode, profileVersion, typesCreated, attributesCreated, customConflicts };
}

export async function listBusinessProfilePresets(): Promise<BusinessProfilePreset[]> {
  const { data, error } = await supabase
    .from('industry_presets')
    .select('*')
    .eq('active', true)
    .order('sort_order');
  if (error) throw error;
  return data || [];
}

export async function getOrganizationBusinessProfile(orgId: string): Promise<OrganizationBusinessProfile | null> {
  const { data, error } = await supabase
    .from('organization_business_profiles')
    .select('*')
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function configureBusinessProfile(orgId: string, industryCode: string): Promise<BusinessProfileApplication> {
  const { data, error } = await supabase.rpc('configure_business_profile', {
    p_org_id: orgId,
    p_industry_code: industryCode,
  });
  if (error) throw error;
  return parseApplication(data);
}

export async function completeBusinessOnboarding(input: {
  orgId: string;
  businessName: string;
  primaryColor: string;
  industryCode: string;
  onboardingGoal: ActivationGoal;
}): Promise<BusinessProfileApplication> {
  const { data, error } = await supabase.rpc('complete_business_onboarding', {
    p_org_id: input.orgId,
    p_business_name: input.businessName,
    p_primary_color: input.primaryColor,
    p_industry_code: input.industryCode,
    p_onboarding_goal: input.onboardingGoal,
  });
  if (error) throw error;
  if (!isRecord(data) || !isRecord(data.profile)) {
    throw new Error('El servidor no confirmo el perfil de negocio');
  }
  return parseApplication(data.profile as Json);
}
