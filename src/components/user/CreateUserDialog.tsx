
import React from 'react';
import { RecordDialog } from '@/components/common/RecordDialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useForm } from 'react-hook-form';
import { supabase } from '@/integrations/supabase/client';
import { createInviteClient } from '@/integrations/supabase/inviteClient';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useCurrentOrganization } from '@/hooks/useCurrentOrganization';
import { getInvitationRedirectUrl, sendExistingUserInvitationEmail } from '@/hooks/useInvitations';
import { MEMBER_ROLES, type MemberRole } from '@/lib/roles';

interface CreateUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface CreateUserForm {
  email: string;
  full_name: string;
  phone: string;
  role: MemberRole;
}

// New members start with the least access; the inviter can pick a higher role
const DEFAULT_VALUES: CreateUserForm = { email: '', full_name: '', phone: '', role: 'viewer' };

export const CreateUserDialog = ({ open, onOpenChange }: CreateUserDialogProps) => {
  const { register, handleSubmit, reset, setValue, watch, formState: { isSubmitting } } = useForm<CreateUserForm>({ defaultValues: DEFAULT_VALUES });
  const queryClient = useQueryClient();
  const { organizationId } = useCurrentOrganization();

  const selectedRole = watch('role');

  const onSubmit = async (data: CreateUserForm) => {
    if (!organizationId) {
      toast.error('請先選擇組織');
      return;
    }

    try {
      console.log('Creating user with data:', data);

      // 信箱若已註冊，signUp 不會報錯而是回傳假的 user id，因此先嘗試
      // 為既有帳號建立「邀請中」的成員資格；找不到帳號（回傳 null）才走註冊邀請流程。
      const { data: existingUserId, error: existingUserError } = await supabase.rpc(
        'add_existing_user_to_organization',
        {
          _email: data.email,
          _organization_id: organizationId,
          _role: data.role,
        }
      );

      if (existingUserError) {
        throw existingUserError;
      }

      if (existingUserId) {
        queryClient.invalidateQueries({ queryKey: ['organization_users'] });
        try {
          await sendExistingUserInvitationEmail(data.email);
          toast.success('邀請郵件已發送，對方接受邀請後才會成為組織成員');
        } catch (emailError) {
          console.error('Error sending invitation email:', emailError);
          toast.warning(
            `邀請已建立，但邀請郵件發送失敗：${(emailError as { message?: string }).message ?? '未知錯誤'}。可稍後在使用者列表點「重新發送邀請」`
          );
        }
        reset(DEFAULT_VALUES);
        onOpenChange(false);
        return;
      }

      // 使用 signUp 而不是 admin.inviteUserByEmail（前端沒有 service role key）。
      // 透過獨立的 inviteClient 呼叫，避免 signUp 回傳的 session 覆蓋掉目前登入
      // 管理員自己的 session。
      const { data: signUpData, error: signUpError } = await createInviteClient().auth.signUp({
        email: data.email,
        password: Math.random().toString(36).slice(-8), // 臨時密碼
        options: {
          data: {
            full_name: data.full_name,
            phone: data.phone,
            organization_id: organizationId,
            role: data.role
          },
          // 使用者確認信箱後進入接受邀請頁面，接受後才成為組織成員
          emailRedirectTo: getInvitationRedirectUrl()
        }
      });

      if (signUpError) {
        console.error('SignUp error:', signUpError);
        throw signUpError;
      }

      if (!signUpData.user) {
        throw new Error('建立帳號失敗，請稍後再試');
      }

      // 空的 identities 代表信箱已被註冊，回傳的 user id 是假的，不能拿去寫入組織
      if (signUpData.user.identities?.length === 0) {
        throw new Error('此信箱已被註冊，請稍後再試一次');
      }

      // 補 profile 欄位、加入組織、指派角色、寫操作紀錄全部收進一個
      // transaction 式 RPC，任何一步失敗就整個 rollback，並把錯誤拋出來
      // 讓下面的 catch 區塊顯示給管理員看，而不是悄悄留下殘缺資料。
      const { error: completeError } = await supabase.rpc('complete_user_invitation', {
        _user_id: signUpData.user.id,
        _organization_id: organizationId,
        _role: data.role,
        _full_name: data.full_name || null,
        _phone: data.phone || null,
      });

      if (completeError) {
        throw completeError;
      }

      queryClient.invalidateQueries({ queryKey: ['organization_users'] });
      toast.success('邀請郵件已發送，對方完成註冊並接受邀請後才會成為組織成員');
      reset(DEFAULT_VALUES);
      onOpenChange(false);
    } catch (error) {
      console.error('Error creating user:', error);
      toast.error(`創建使用者失敗: ${(error as { message?: string }).message ?? '未知錯誤'}`);
    }
  };

  return (
    <RecordDialog
      open={open}
      onOpenChange={onOpenChange}
      mode="create"
      title="新增使用者"
      description="輸入使用者資訊，系統將發送邀請郵件讓用戶完成註冊"
      formId="create-user-form"
      submitting={isSubmitting}
      submitLabel="建立使用者"
    >
        <form id="create-user-form" onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">電子信箱 *</Label>
            <Input
              id="email"
              type="email"
              {...register('email', { required: true })}
              placeholder="請輸入電子信箱"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="full_name">姓名</Label>
            <Input
              id="full_name"
              {...register('full_name')}
              placeholder="請輸入姓名"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">電話</Label>
            <Input
              id="phone"
              {...register('phone')}
              placeholder="請輸入電話"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="role">角色 *</Label>
            <Select onValueChange={(value) => setValue('role', value as MemberRole)} value={selectedRole}>
              <SelectTrigger id="role">
                <SelectValue placeholder="選擇角色" />
              </SelectTrigger>
              <SelectContent>
                {MEMBER_ROLES.map((role) => (
                  <SelectItem key={role.value} value={role.value}>
                    {role.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-sm text-gray-500">
              {MEMBER_ROLES.find((role) => role.value === selectedRole)?.description}
            </p>
          </div>
        </form>
    </RecordDialog>
  );
};
