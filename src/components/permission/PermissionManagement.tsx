
import React, { useState } from 'react';
import { EnhancedTable, TableColumn } from '@/components/ui/enhanced-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PermissionGuard } from '@/components/PermissionGuard';
import { Switch } from '@/components/ui/switch';
import { Edit } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface PermissionRow {
  feature: string;
  admin: boolean;
  sales: boolean;
  assistant: boolean;
  accounting: boolean;
  warehouse: boolean;
}

export const PermissionManagement: React.FC = () => {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [permissionData, setPermissionData] = useState<PermissionRow[]>([
    { feature: '查看產品', admin: true, sales: true, assistant: true, accounting: true, warehouse: true },
    { feature: '創建產品', admin: true, sales: false, assistant: true, accounting: false, warehouse: false },
    { feature: '編輯產品', admin: true, sales: false, assistant: true, accounting: false, warehouse: false },
    { feature: '刪除產品', admin: true, sales: false, assistant: false, accounting: false, warehouse: false },
    { feature: '查看庫存', admin: true, sales: true, assistant: true, accounting: true, warehouse: true },
    { feature: '創建庫存', admin: true, sales: false, assistant: true, accounting: false, warehouse: true },
    { feature: '編輯庫存', admin: true, sales: false, assistant: true, accounting: false, warehouse: true },
    { feature: '查看訂單', admin: true, sales: true, assistant: true, accounting: true, warehouse: true },
    { feature: '創建訂單', admin: true, sales: true, assistant: true, accounting: false, warehouse: false },
    { feature: '編輯訂單', admin: true, sales: true, assistant: true, accounting: false, warehouse: false },
    { feature: '查看採購', admin: true, sales: true, assistant: true, accounting: true, warehouse: true },
    { feature: '創建採購', admin: true, sales: false, assistant: true, accounting: false, warehouse: false },
    { feature: '編輯採購', admin: true, sales: false, assistant: true, accounting: false, warehouse: false },
    { feature: '查看出貨', admin: true, sales: true, assistant: true, accounting: true, warehouse: true },
    { feature: '創建出貨', admin: true, sales: false, assistant: true, accounting: false, warehouse: true },
    { feature: '編輯出貨', admin: true, sales: false, assistant: true, accounting: false, warehouse: true },
    { feature: '查看客戶', admin: true, sales: true, assistant: true, accounting: true, warehouse: false },
    { feature: '創建客戶', admin: true, sales: true, assistant: true, accounting: false, warehouse: false },
    { feature: '編輯客戶', admin: true, sales: true, assistant: true, accounting: false, warehouse: false },
    { feature: '查看工廠', admin: true, sales: true, assistant: true, accounting: true, warehouse: false },
    { feature: '創建工廠', admin: true, sales: false, assistant: true, accounting: false, warehouse: false },
    { feature: '編輯工廠', admin: true, sales: false, assistant: true, accounting: false, warehouse: false },
    { feature: '查看用戶', admin: true, sales: false, assistant: false, accounting: false, warehouse: false },
    { feature: '創建用戶', admin: true, sales: false, assistant: false, accounting: false, warehouse: false },
    { feature: '編輯用戶', admin: true, sales: false, assistant: false, accounting: false, warehouse: false },
    { feature: '查看權限', admin: true, sales: false, assistant: false, accounting: false, warehouse: false },
    { feature: '編輯權限', admin: true, sales: false, assistant: false, accounting: false, warehouse: false },
    { feature: '查看系統設定', admin: true, sales: false, assistant: false, accounting: false, warehouse: false },
    { feature: '編輯系統設定', admin: true, sales: false, assistant: false, accounting: false, warehouse: false },
  ]);

  const handlePermissionToggle = (rowIndex: number, role: keyof Omit<PermissionRow, 'feature'>) => {
    if (!isEditing) return;
    
    const newData = [...permissionData];
    newData[rowIndex] = {
      ...newData[rowIndex],
      [role]: !newData[rowIndex][role]
    };
    setPermissionData(newData);
  };

  const handleSave = () => {
    // 這裡應該調用 API 來保存權限設定
    console.log('Saving permissions:', permissionData);
    toast({
      title: "權限設定已保存",
      description: "角色權限矩陣已成功更新",
    });
    setIsEditing(false);
  };

  const handleCancel = () => {
    // 重置到原始狀態
    setIsEditing(false);
    // 這裡可以重新載入原始數據
  };

  const renderPermissionCell = (value: boolean, rowIndex: number, role: keyof Omit<PermissionRow, 'feature'>) => {
    if (isEditing && role !== 'admin') {
      return (
        <Switch
          checked={value}
          onCheckedChange={() => handlePermissionToggle(rowIndex, role)}
          className="data-[state=checked]:bg-green-600"
        />
      );
    }
    
    return (
      <Badge variant={value ? "default" : "secondary"} className={value ? "bg-green-100 text-green-800" : ""}>
        {value ? '允許' : '禁止'}
      </Badge>
    );
  };

  const columns: TableColumn[] = [
    {
      key: 'feature',
      title: '功能',
      sortable: true,
    },
    {
      key: 'admin',
      title: '管理員',
      render: (value, row) => {
        const rowIndex = permissionData.findIndex(item => item.feature === row.feature);
        return renderPermissionCell(value, rowIndex, 'admin');
      },
      filterable: true,
      filterOptions: [
        { value: 'true', label: '允許' },
        { value: 'false', label: '禁止' },
      ],
    },
    {
      key: 'sales',
      title: '業務',
      render: (value, row) => {
        const rowIndex = permissionData.findIndex(item => item.feature === row.feature);
        return renderPermissionCell(value, rowIndex, 'sales');
      },
      filterable: true,
      filterOptions: [
        { value: 'true', label: '允許' },
        { value: 'false', label: '禁止' },
      ],
    },
    {
      key: 'assistant',
      title: '助理',
      render: (value, row) => {
        const rowIndex = permissionData.findIndex(item => item.feature === row.feature);
        return renderPermissionCell(value, rowIndex, 'assistant');
      },
      filterable: true,
      filterOptions: [
        { value: 'true', label: '允許' },
        { value: 'false', label: '禁止' },
      ],
    },
    {
      key: 'accounting',
      title: '會計',
      render: (value, row) => {
        const rowIndex = permissionData.findIndex(item => item.feature === row.feature);
        return renderPermissionCell(value, rowIndex, 'accounting');
      },
      filterable: true,
      filterOptions: [
        { value: 'true', label: '允許' },
        { value: 'false', label: '禁止' },
      ],
    },
    {
      key: 'warehouse',
      title: '倉庫管理員',
      render: (value, row) => {
        const rowIndex = permissionData.findIndex(item => item.feature === row.feature);
        return renderPermissionCell(value, rowIndex, 'warehouse');
      },
      filterable: true,
      filterOptions: [
        { value: 'true', label: '允許' },
        { value: 'false', label: '禁止' },
      ],
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">權限管理</h1>
          <p className="text-slate-600 mt-2">查看和管理系統各角色的功能權限</p>
        </div>
        <PermissionGuard permission="canEditPermissions">
          <div className="flex gap-2">
            {!isEditing ? (
              <Button onClick={() => setIsEditing(true)} className="flex items-center gap-2">
                <Edit className="h-4 w-4" />
                編輯權限
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button onClick={handleSave} variant="default">
                  保存
                </Button>
                <Button onClick={handleCancel} variant="outline">
                  取消
                </Button>
              </div>
            )}
          </div>
        </PermissionGuard>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            角色權限矩陣
            {isEditing && (
              <Badge variant="secondary" className="bg-blue-100 text-blue-800">
                編輯模式
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            此表格顯示不同角色對各功能模組的存取權限
            {isEditing && " - 點擊開關來調整權限設定"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EnhancedTable
            columns={columns}
            data={permissionData}
            searchPlaceholder="搜尋功能..."
            emptyMessage="暫無權限資料"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>角色說明</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="p-4 border rounded-lg">
              <h3 className="font-semibold text-blue-600 mb-2">管理員</h3>
              <p className="text-sm text-slate-600">擁有系統完整權限，可以管理所有功能和用戶</p>
            </div>
            <div className="p-4 border rounded-lg">
              <h3 className="font-semibold text-green-600 mb-2">業務</h3>
              <p className="text-sm text-slate-600">負責訂單和客戶管理，可查看相關報表</p>
            </div>
            <div className="p-4 border rounded-lg">
              <h3 className="font-semibold text-purple-600 mb-2">助理</h3>
              <p className="text-sm text-slate-600">協助業務和生產管理，擁有大部分操作權限</p>
            </div>
            <div className="p-4 border rounded-lg">
              <h3 className="font-semibold text-orange-600 mb-2">會計</h3>
              <p className="text-sm text-slate-600">負責財務相關功能，主要查看權限</p>
            </div>
            <div className="p-4 border rounded-lg">
              <h3 className="font-semibold text-indigo-600 mb-2">倉庫管理員</h3>
              <p className="text-sm text-slate-600">負責庫存和出貨管理</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
