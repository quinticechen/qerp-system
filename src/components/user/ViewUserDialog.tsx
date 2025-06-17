
import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

interface ViewUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: any;
}

export const ViewUserDialog = ({ open, onOpenChange, user }: ViewUserDialogProps) => {
  const getRoleBadge = (role: string) => {
    const roleMap = {
      admin: 'bg-red-100 text-red-800 border-red-200',
      sales: 'bg-blue-100 text-blue-800 border-blue-200',
      assistant: 'bg-green-100 text-green-800 border-green-200',
      accounting: 'bg-yellow-100 text-yellow-800 border-yellow-200',
      warehouse: 'bg-purple-100 text-purple-800 border-purple-200'
    };
    return roleMap[role as keyof typeof roleMap] || 'bg-gray-100 text-gray-800 border-gray-200';
  };

  const getRoleText = (role: string) => {
    const roleTextMap = {
      admin: '管理員',
      sales: '業務',
      assistant: '助理',
      accounting: '會計',
      warehouse: '倉管'
    };
    return roleTextMap[role as keyof typeof roleTextMap] || role;
  };

  const roles = Array.isArray(user?.roles) ? user.roles : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
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
                <Badge variant="outline" className={user?.is_active ? 'bg-green-100 text-green-800 border-green-200' : 'bg-red-100 text-red-800 border-red-200'}>
                  {user?.is_active ? '啟用' : '停用'}
                </Badge>
              </div>
            </div>
          </div>

          <Separator />

          {/* 角色資訊 */}
          <div>
            <h3 className="text-lg font-medium mb-3">角色權限</h3>
            <div className="space-y-3">
              {roles.length > 0 ? (
                roles.map((roleInfo: any, index: number) => (
                  <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center space-x-3">
                      <Badge variant="outline" className={getRoleBadge(roleInfo.role)}>
                        {getRoleText(roleInfo.role)}
                      </Badge>
                      <div>
                        <p className="text-sm text-gray-600">
                          授予時間：{new Date(roleInfo.granted_at).toLocaleString('zh-TW')}
                        </p>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-gray-500">此使用者尚未分配任何角色</p>
              )}
            </div>
          </div>

          <Separator />

          {/* 時間資訊 */}
          <div>
            <h3 className="text-lg font-medium mb-3">時間資訊</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-500">建立時間</label>
                <p className="text-gray-900">
                  {new Date(user?.created_at).toLocaleString('zh-TW')}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">最後更新</label>
                <p className="text-gray-900">
                  {new Date(user?.updated_at).toLocaleString('zh-TW')}
                </p>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
