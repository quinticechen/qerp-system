import React, { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { useCurrentOrganization } from '@/hooks/useCurrentOrganization';
import { setPartnerActive, updatePartner, type PartnerKind } from '@/lib/api/partners';
import { apiErrorMessage } from '@/lib/api/client';
import {
  PARTNER_LABELS,
  partnerFieldDefs,
  toPartnerForm,
  validatePartnerForm,
  EMPTY_PARTNER_FORM,
  type PartnerFieldKey,
  type PartnerForm,
  type PartnerRow,
} from '@/lib/partnerForm';
import { RecordDialog } from './RecordDialog';
import { DetailSection } from './DetailSection';
import { DetailField } from './DetailField';
import { PartnerFormFields } from './PartnerFormFields';
import { ActiveToggleButton } from './ActiveToggleButton';

interface PartnerDialogProps {
  kind: PartnerKind;
  // Pass the row from the latest list data so the view shows saved changes
  partner: PartnerRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canEdit: boolean;
}

const LIST_QUERY_KEY: Record<PartnerKind, string> = { customer: 'customers', factory: 'factories' };

// A customer or factory: every field in view mode, the same fields as the create form in edit mode
export const PartnerDialog = ({ kind, partner, open, onOpenChange, canEdit }: PartnerDialogProps) => {
  const queryClient = useQueryClient();
  const { organizationId } = useCurrentOrganization();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<PartnerForm>(EMPTY_PARTNER_FORM);
  const [errors, setErrors] = useState<Partial<Record<PartnerFieldKey, string>>>({});
  const [saving, setSaving] = useState(false);
  const label = PARTNER_LABELS[kind];

  // Every opening starts in view mode
  useEffect(() => {
    if (open) setEditing(false);
  }, [open, partner?.id]);

  if (!partner) return null;

  const refresh = () => queryClient.invalidateQueries({ queryKey: [LIST_QUERY_KEY[kind]] });

  const startEditing = () => {
    setForm(toPartnerForm(partner));
    setErrors({});
    setEditing(true);
  };

  const handleSave = async () => {
    const problems = validatePartnerForm(form, kind);
    setErrors(problems);
    if (Object.keys(problems).length > 0 || !organizationId) return;

    setSaving(true);
    try {
      // The API only changes fields that differ and checks the same rules again
      await updatePartner(kind, organizationId, partner.id, form);
      toast.success(`${label}已更新`);
      await refresh();
      setEditing(false);
    } catch (error) {
      toast.error(`更新${label}失敗：${apiErrorMessage(error)}`);
    } finally {
      setSaving(false);
    }
  };

  // Disabled partners stay on existing documents but are hidden from pickers for new ones
  const handleToggleActive = async () => {
    if (!organizationId) return;
    setSaving(true);
    try {
      await setPartnerActive(kind, organizationId, partner.id, !partner.is_active);
      toast.success(partner.is_active ? `${label}已停用` : `${label}已啟用`);
      await refresh();
      setEditing(false);
    } catch (error) {
      toast.error(`變更${label}狀態失敗：${apiErrorMessage(error)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <RecordDialog
      open={open}
      onOpenChange={onOpenChange}
      mode={editing ? 'edit' : 'view'}
      title={editing ? `編輯${label}` : `${label}詳情`}
      description={partner.name}
      size="lg"
      history={{ recordId: partner.id }}
      onEdit={canEdit ? startEditing : undefined}
      onCancelEdit={() => setEditing(false)}
      onSubmit={handleSave}
      submitting={saving}
      editActions={
        <ActiveToggleButton isActive={partner.is_active} subject={label} onToggle={handleToggleActive} disabled={saving} />
      }
    >
      {editing ? (
        <PartnerFormFields
          kind={kind}
          form={form}
          errors={errors}
          onChange={(key, value) => {
            setForm((current) => ({ ...current, [key]: value }));
            setErrors((current) => ({ ...current, [key]: undefined }));
          }}
        />
      ) : (
        <DetailSection fields>
          {partnerFieldDefs(kind).map((field) => (
            <DetailField key={field.key} label={field.label} wide={field.type === 'textarea'}>
              {partner[field.key]}
            </DetailField>
          ))}
          <DetailField label="狀態">
            <Badge
              variant="outline"
              className={partner.is_active ? 'border-green-200 bg-green-100 text-green-800' : 'border-gray-200 bg-gray-100 text-gray-600'}
            >
              {partner.is_active ? '啟用' : '停用'}
            </Badge>
          </DetailField>
          <DetailField label="建立時間">{new Date(partner.created_at).toLocaleString('zh-TW')}</DetailField>
        </DetailSection>
      )}
    </RecordDialog>
  );
};
