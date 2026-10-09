import { useState } from 'react';
import { useOrganizationPermissions } from '@/hooks/useOrganizationPermissions';
import { useOrganizationContext } from '@/contexts/OrganizationContext';
import { useRolePermissions } from '@/hooks/useRolePermissions';
import { useRoleMemberCounts } from '@/hooks/useRoleMemberCounts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TransferOwnershipDialog } from './TransferOwnershipDialog';
import { ArrowRightLeft } from 'lucide-react';
import { PERMISSION_GROUPS } from '@/lib/permissionLabels';
import { MEMBER_ROLES, ROLE_BADGE_CLASSES, ROLE_LABELS, type OrganizationRole } from '@/lib/roles';

const COLUMNS: OrganizationRole[] = ['owner', 'admin', 'editor', 'viewer'];

const OWNER_DESCRIPTION = '擁有組織的所有權限，並可以轉移擁有權、刪除組織';

// Read-only overview of the four fixed roles (docs/requirements/MULTI_TENANT_RBAC.md §4.2). Roles are assigned in user management.
export const OrganizationRoleManagement = () => {
  const { currentOrganization, refreshOrganizations } = useOrganizationContext();
  const { isOwner } = useOrganizationPermissions();
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const { data: rolePermissions, isLoading, error } = useRolePermissions();
  const { data: memberCounts, refetch: refetchCounts } = useRoleMemberCounts(
    currentOrganization?.id,
    currentOrganization?.owner_id,
  );

  if (!currentOrganization) {
    return <div>請先選擇組織</div>;
  }

  // The owner holds the admin set; other roles hold what role_permissions lists for them
  const holds = (role: OrganizationRole, key: string) =>
    !!rolePermissions && rolePermissions[role === 'owner' ? 'admin' : role].has(key);

  const describe = (role: OrganizationRole, permissions: readonly { key: string; action: string }[]) => {
    const actions = permissions.filter((permission) => holds(role, permission.key)).map((permission) => permission.action);
    return actions.length > 0 ? actions.join('、') : '–';
  };

  const roleCards = [
    { role: 'owner' as const, description: OWNER_DESCRIPTION },
    ...MEMBER_ROLES.map((option) => ({ role: option.value, description: option.description })),
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-slate-800">角色說明</h2>
        {isOwner && (
          <Button variant="outline" onClick={() => setTransferDialogOpen(true)}>
            <ArrowRightLeft className="mr-2 h-4 w-4" />
            轉移擁有權
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {roleCards.map(({ role, description }) => (
          <Card key={role}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <Badge variant="outline" className={ROLE_BADGE_CLASSES[role]}>
                  {ROLE_LABELS[role]}
                </Badge>
                <span className="text-sm text-gray-600">{memberCounts?.[role] ?? 0} 名成員</span>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600">{description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>各角色可使用的功能</CardTitle>
          <CardDescription>
            角色固定為以上四種，於用戶管理指派。所有修改都會留下編輯紀錄。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-4 text-center text-gray-500">載入中...</div>
          ) : error ? (
            <div className="py-4 text-center text-red-600">無法載入角色權限</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>功能</TableHead>
                  {COLUMNS.map((role) => (
                    <TableHead key={role} className="whitespace-nowrap">{ROLE_LABELS[role]}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(PERMISSION_GROUPS).map(([group, permissions]) => (
                  <TableRow key={group}>
                    <TableCell className="whitespace-nowrap font-medium">{group}</TableCell>
                    {COLUMNS.map((role) => (
                      <TableCell key={role} className="whitespace-nowrap text-gray-700">
                        {describe(role, permissions)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell className="whitespace-nowrap font-medium">轉移擁有權、刪除組織</TableCell>
                  {COLUMNS.map((role) => (
                    <TableCell key={role} className="text-gray-700">
                      {role === 'owner' ? '可以' : '–'}
                    </TableCell>
                  ))}
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <TransferOwnershipDialog
        open={transferDialogOpen}
        onOpenChange={setTransferDialogOpen}
        // Reload the organization so its owner_id, and with it everyone's permissions, are current
        onSuccess={() => {
          refreshOrganizations();
          refetchCounts();
        }}
      />
    </div>
  );
};
