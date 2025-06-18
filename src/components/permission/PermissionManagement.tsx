
import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { OrganizationRoleManagement } from '@/components/organization/OrganizationRoleManagement';
import { Badge } from '@/components/ui/badge';
import { Shield, Users, Settings } from 'lucide-react';
import { useOrganizationContext } from '@/contexts/OrganizationContext';
import { useOrganizationPermissions } from '@/hooks/useOrganizationPermissions';

export const PermissionManagement: React.FC = () => {
  const { currentOrganization } = useOrganizationContext();
  const { isOwner } = useOrganizationPermissions();

  return (
    <div>
      <OrganizationRoleManagement />
    </div>
    // <div className="space-y-6">
    //   <div className="flex justify-between items-center">
    //     <div>
    //       <h1 className="text-3xl font-bold text-slate-800">權限管理</h1>
    //       <p className="text-slate-600 mt-2">
    //         管理 {currentOrganization?.name} 的角色權限和使用者權限
    //       </p>
    //     </div>
    //     <Badge variant="secondary" className="bg-blue-100 text-blue-800">
    //       <Shield className="h-3 w-3 mr-1" />
    //       組織層級權限管理
    //     </Badge>
    //   </div>

    //   <Tabs defaultValue="roles" className="space-y-6">
    //     <TabsList className="grid w-full grid-cols-2">
    //       <TabsTrigger value="roles" className="flex items-center gap-2">
    //         <Users className="h-4 w-4" />
    //         角色管理
    //       </TabsTrigger>
    //       <TabsTrigger value="settings" className="flex items-center gap-2">
    //         <Settings className="h-4 w-4" />
    //         權限設定
    //       </TabsTrigger>
    //     </TabsList>

    //     <TabsContent value="roles" className="space-y-6">
    //       <OrganizationRoleManagement />
    //     </TabsContent>

    //     <TabsContent value="settings" className="space-y-6">
    //       <Card>
    //         <CardHeader>
    //           <CardTitle>組織權限設定</CardTitle>
    //           <CardDescription>
    //             配置組織層級的權限策略和安全設定
    //           </CardDescription>
    //         </CardHeader>
    //         <CardContent>
    //           <div className="space-y-4">
    //             <div className="p-4 bg-gray-50 rounded-lg">
    //               <h4 className="font-medium mb-2">組織權限架構</h4>
    //               <ul className="text-sm text-gray-600 space-y-1">
    //                 <li>• 組織擁有者擁有所有權限</li>
    //                 <li>• 系統角色提供預設權限配置</li>
    //                 <li>• 自定義角色允許彈性權限設定</li>
    //                 <li>• 使用者可被分配多個角色</li>
    //               </ul>
    //             </div>

    //             {isOwner && (
    //               <div className="p-4 bg-blue-50 rounded-lg">
    //                 <h4 className="font-medium mb-2 text-blue-800">擁有者特權</h4>
    //                 <p className="text-sm text-blue-600">
    //                   作為組織擁有者，您擁有管理組織、使用者和角色的完整權限。
    //                 </p>
    //               </div>
    //             )}

    //             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
    //               <div className="p-4 border rounded-lg">
    //                 <h4 className="font-medium mb-2">系統角色</h4>
    //                 <p className="text-sm text-gray-600 mb-2">
    //                   系統預設角色，包含標準權限配置
    //                 </p>
    //                 <div className="space-y-1">
    //                   <Badge variant="outline">管理員</Badge>
    //                   <Badge variant="outline">業務</Badge>
    //                   <Badge variant="outline">助理</Badge>
    //                   <Badge variant="outline">會計</Badge>
    //                   <Badge variant="outline">倉庫管理員</Badge>
    //                 </div>
    //               </div>
                  
    //               <div className="p-4 border rounded-lg">
    //                 <h4 className="font-medium mb-2">自定義角色</h4>
    //                 <p className="text-sm text-gray-600 mb-2">
    //                   根據組織需求創建的專屬角色
    //                 </p>
    //                 <Button variant="outline" size="sm" disabled={!isOwner}>
    //                   創建自定義角色
    //                 </Button>
    //               </div>
    //             </div>
    //           </div>
    //         </CardContent>
    //       </Card>
    //     </TabsContent>
    //   </Tabs>
    // </div>
  );
};
