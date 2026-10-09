import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { createPartner, type PartnerKind } from '@/lib/api/partners';
import { apiErrorMessage } from '@/lib/api/client';
import { useCurrentOrganization } from '@/hooks/useCurrentOrganization';
import { EMPTY_PARTNER_FORM, PARTNER_LABELS, validatePartnerForm, type PartnerFieldKey, type PartnerForm } from '@/lib/partnerForm';
import { RecordDialog } from './RecordDialog';
import { PartnerFormFields } from './PartnerFormFields';

interface CreateEntityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEntityCreated: () => void;
  entityType: PartnerKind;
}

// Creates a customer or factory with the same form its edit mode uses
export const CreateEntityDialog: React.FC<CreateEntityDialogProps> = ({ open, onOpenChange, onEntityCreated, entityType }) => {
  const [saving, setSaving] = useState(false);
  const { organizationId } = useCurrentOrganization();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<PartnerForm>(EMPTY_PARTNER_FORM);
  const [errors, setErrors] = useState<Partial<Record<PartnerFieldKey, string>>>({});
  const label = PARTNER_LABELS[entityType];

  const reset = () => {
    setForm(EMPTY_PARTNER_FORM);
    setErrors({});
  };

  const handleSubmit = async () => {
    const problems = validatePartnerForm(form, entityType);
    setErrors(problems);
    if (Object.keys(problems).length > 0) return;
    if (!organizationId) {
      toast.error('請先選擇組織');
      return;
    }

    setSaving(true);
    try {
      // The API applies the same rules again and is the one that decides
      await createPartner(entityType, organizationId, form);
      toast.success(`${label}已建立`);
      // Lists and pickers of this entity refresh without reloading the page
      queryClient.invalidateQueries({ queryKey: [entityType === 'customer' ? 'customers' : 'factories'] });
      reset();
      onEntityCreated();
      onOpenChange(false);
    } catch (error) {
      toast.error(`建立${label}失敗：${apiErrorMessage(error)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <RecordDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      mode="create"
      title={`新增${label}`}
      size="lg"
      onSubmit={handleSubmit}
      submitting={saving}
    >
      <PartnerFormFields
        kind={entityType}
        form={form}
        errors={errors}
        onChange={(key, value) => {
          setForm((current) => ({ ...current, [key]: value }));
          setErrors((current) => ({ ...current, [key]: undefined }));
        }}
      />
    </RecordDialog>
  );
};
