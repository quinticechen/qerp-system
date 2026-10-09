import type { PartnerKind } from '@/lib/api/partners';

// Customers and factories share their fields; this is the form both create and edit use

export const PARTNER_LABELS: Record<PartnerKind, string> = { customer: '客戶', factory: '工廠' };

export interface PartnerRow {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  landline_phone: string | null;
  fax: string | null;
  email: string | null;
  address: string | null;
  note: string | null;
  is_active: boolean;
  created_at: string;
  updated_at?: string | null;
}

export type PartnerFieldKey = 'name' | 'contact_person' | 'phone' | 'landline_phone' | 'fax' | 'email' | 'address' | 'note';

export type PartnerForm = Record<PartnerFieldKey, string>;

export interface PartnerFieldDef {
  key: PartnerFieldKey;
  label: string;
  type: 'text' | 'email' | 'textarea';
  required?: boolean;
  placeholder?: string;
}

const PHONE_HINT = '至少填寫手機或市話其中一個';

export const partnerFieldDefs = (kind: PartnerKind): PartnerFieldDef[] => [
  { key: 'name', label: `${PARTNER_LABELS[kind]}名稱`, type: 'text', required: true },
  { key: 'contact_person', label: '聯絡人', type: 'text', required: true },
  { key: 'phone', label: '手機', type: 'text', placeholder: PHONE_HINT },
  { key: 'landline_phone', label: '市話', type: 'text', placeholder: PHONE_HINT },
  { key: 'fax', label: '傳真', type: 'text' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'address', label: '地址', type: 'textarea' },
  { key: 'note', label: '備註', type: 'textarea' },
];

export const EMPTY_PARTNER_FORM: PartnerForm = {
  name: '',
  contact_person: '',
  phone: '',
  landline_phone: '',
  fax: '',
  email: '',
  address: '',
  note: '',
};

export const toPartnerForm = (row: PartnerRow): PartnerForm => ({
  name: row.name ?? '',
  contact_person: row.contact_person ?? '',
  phone: row.phone ?? '',
  landline_phone: row.landline_phone ?? '',
  fax: row.fax ?? '',
  email: row.email ?? '',
  address: row.address ?? '',
  note: row.note ?? '',
});

// The same rules the API checks, so mistakes show next to the field before saving
export const validatePartnerForm = (form: PartnerForm, kind: PartnerKind): Partial<Record<PartnerFieldKey, string>> => {
  const errors: Partial<Record<PartnerFieldKey, string>> = {};
  if (!form.name.trim()) errors.name = `請輸入${PARTNER_LABELS[kind]}名稱`;
  if (!form.contact_person.trim()) errors.contact_person = '請輸入聯絡人';
  if (!form.phone.trim() && !form.landline_phone.trim()) {
    errors.phone = '請至少輸入一個電話號碼';
    errors.landline_phone = '請至少輸入一個電話號碼';
  }
  return errors;
};
