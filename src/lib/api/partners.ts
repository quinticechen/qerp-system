import { callApi, type ApiChanges } from './client';

// Customers and factories share their fields and rules (docs/BUSINESS_API.md §3, A1)

export type PartnerKind = 'customer' | 'factory';

export interface PartnerFields {
  name: string;
  contact_person: string;
  phone?: string;
  landline_phone?: string;
  fax?: string;
  email?: string;
  address?: string;
  note?: string;
}

const toCreateArgs = (organizationId: string, fields: PartnerFields, dryRun: boolean) => ({
  p_organization_id: organizationId,
  p_name: fields.name,
  p_contact_person: fields.contact_person,
  p_phone: fields.phone,
  p_landline_phone: fields.landline_phone,
  p_fax: fields.fax,
  p_email: fields.email,
  p_address: fields.address,
  p_note: fields.note,
  p_dry_run: dryRun,
});

export const createPartner = (kind: PartnerKind, organizationId: string, fields: PartnerFields, dryRun = false) =>
  callApi(kind === 'customer' ? 'create_customer' : 'create_factory', toCreateArgs(organizationId, fields, dryRun));

// Only the fields present in `changes` are updated; an empty string clears a field
export const updatePartner = (kind: PartnerKind, organizationId: string, id: string, changes: ApiChanges, dryRun = false) =>
  kind === 'customer'
    ? callApi('update_customer', { p_organization_id: organizationId, p_customer_id: id, p_changes: changes, p_dry_run: dryRun })
    : callApi('update_factory', { p_organization_id: organizationId, p_factory_id: id, p_changes: changes, p_dry_run: dryRun });

export const setPartnerActive = (kind: PartnerKind, organizationId: string, id: string, isActive: boolean, dryRun = false) =>
  kind === 'customer'
    ? callApi('set_customer_active', { p_organization_id: organizationId, p_customer_id: id, p_is_active: isActive, p_dry_run: dryRun })
    : callApi('set_factory_active', { p_organization_id: organizationId, p_factory_id: id, p_is_active: isActive, p_dry_run: dryRun });
