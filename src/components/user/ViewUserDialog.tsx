
import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { RecordAuditHistoryButton } from '@/components/common/RecordAuditHistoryButton';
import { MEMBER_ROLES, ROLE_BADGE_CLASSES, ROLE_LABELS } from '@/lib/roles';
import type { OrganizationMember } from '@/types/organizationMember';

interface ViewUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: OrganizationMember;
  onEdit?: () => void;
}

export const ViewUserDialog = ({ open, onOpenChange, user, onEdit }: ViewUserDialogProps) => {
  const roleDescription = user.is_owner
    ? '擁有組織的所有權限，並可以轉移擁有權'
    : MEMBER_ROLES.find((role) => role.value === user.role)?.description;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <RecordAuditHistoryButton recordId={user?.id} className="absolute right-10 top-2" />
          <DialogTitle>使用者詳情</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* 基本資料 */}
          <div>
            <h3 className="text-lg font-medium mb-3">基本資料</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-500">電子信箱</label>
                <p className="text-gray-900">{user?.email}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">姓名</label>
                <p className="text-gray-900">{user?.full_name || '-'}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">電話</label>
                <p className="text-gray-900">{user?.phone || '-'}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">狀態</label>
                {user?.is_pending ? (
                  user?.is_expired ? (
                    <Badge variant="outline" className="bg-red-100 text-red-800 border-red-200">
                      已過期
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-200">
                      邀請中
                    </Badge>
                  )
                ) : (
                  <Badge variant="outline" className={user?.is_active ? 'bg-green-100 text-green-800 border-green-200' : 'bg-red-100 text-red-800 border-red-200'}>
                    {user?.is_active ? '啟用' : '停用'}
                  </Badge>
                )}
              </div>
            </div>
          </div>

          <Separator />

          {/* 角色資訊 */}
          <div>
            <h3 className="text-lg font-medium mb-3">角色權限</h3>
            <div className="flex items-center gap-3 p-3 border rounded-lg">
              <Badge variant="outline" className={ROLE_BADGE_CLASSES[user.role]}>
                {ROLE_LABELS[user.role]}
              </Badge>
              <p className="text-sm text-gray-600">{roleDescription}</p>
            </div>
            {user.is_pending && (
              <p className="mt-2 text-sm text-gray-500">接受邀請後才會取得此角色的權限</p>
            )}
          </div>

          <Separator />

          {/* 時間資訊 */}
          <div>
            <h3 className="text-lg font-medium mb-3">時間資訊</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-500">建立時間</label>
                <p className="text-gray-900">
                  {new Date(user.created_at).toLocaleString('zh-TW')}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">最後更新</label>
                <p className="text-gray-900">
                  {user.updated_at ? new Date(user.updated_at).toLocaleString('zh-TW') : '-'}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            關閉
          </Button>
          {onEdit && <Button onClick={onEdit}>編輯</Button>}
        </div>
      </DialogContent>
    </Dialog>
  );
};
