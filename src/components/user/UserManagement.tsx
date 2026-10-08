
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { UserList } from './UserList';
import { CreateUserDialog } from './CreateUserDialog';
import { UserPlus } from 'lucide-react';
import { usePermissions } from '@/hooks/usePermissions';

export const UserManagement = () => {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const { hasPermission } = usePermissions();
  const canInvite = hasPermission('canCreateUsers');

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-slate-800">使用者管理</h2>
        {canInvite && (
          <Button
            onClick={() => setCreateDialogOpen(true)}
            className="bg-blue-600 hover:bg-blue-700"
          >
            <UserPlus className="mr-2 h-4 w-4" />
            新增使用者
          </Button>
        )}
      </div>

      <UserList />

      {canInvite && (
        <CreateUserDialog
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
        />
      )}
    </div>
  );
};
