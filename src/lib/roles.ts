// Fixed organization roles (docs/MULTI_TENANT_RBAC.md §4.2). What each role may do lives in the
// database table role_permissions; this file only holds what the UI shows for each role.

// Roles a member can be given; the owner is decided by organizations.owner_id instead
export type MemberRole = 'admin' | 'editor' | 'viewer';
export type OrganizationRole = MemberRole | 'owner';

export interface MemberRoleOption {
  value: MemberRole;
  label: string;
  description: string;
}

export const MEMBER_ROLES: MemberRoleOption[] = [
  { value: 'admin', label: '管理員', description: '可以操作所有功能，包含用戶管理與組織設定' },
  { value: 'editor', label: '編輯者', description: '可以新增與編輯業務資料，並查看用戶管理與組織管理' },
  { value: 'viewer', label: '訪客', description: '只能查看業務資料' },
];

export const ROLE_LABELS: Record<OrganizationRole, string> = {
  owner: '擁有者',
  admin: '管理員',
  editor: '編輯者',
  viewer: '訪客',
};

export const ROLE_BADGE_CLASSES: Record<OrganizationRole, string> = {
  owner: 'bg-purple-100 text-purple-800 border-purple-200',
  admin: 'bg-red-100 text-red-800 border-red-200',
  editor: 'bg-blue-100 text-blue-800 border-blue-200',
  viewer: 'bg-gray-100 text-gray-800 border-gray-200',
};

export const isMemberRole = (value: unknown): value is MemberRole =>
  value === 'admin' || value === 'editor' || value === 'viewer';
