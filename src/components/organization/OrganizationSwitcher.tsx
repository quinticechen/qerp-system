
import React, { useState } from 'react';
import { ChevronDown, Building2, Settings } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useOrganizationContext } from '@/contexts/OrganizationContext';

export const OrganizationSwitcher: React.FC = () => {
  const { 
    organizations, 
    currentOrganization, 
    loading, 
    switchOrganization 
  } = useOrganizationContext();

  if (loading || !currentOrganization) {
    return (
      <div className="flex items-center space-x-2">
        <Building2 className="h-4 w-4 text-gray-400" />
        <span className="text-sm text-gray-400">載入中...</span>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="flex items-center space-x-2 px-3 py-2">
          <Building2 className="h-4 w-4" />
          <span className="font-medium">{currentOrganization.name}</span>
          {organizations.length > 1 && <ChevronDown className="h-4 w-4" />}
        </Button>
      </DropdownMenuTrigger>
      
      {organizations.length > 1 && (
        <DropdownMenuContent align="start" className="w-64">
          <div className="px-2 py-1.5">
            <p className="text-sm font-medium">切換組織</p>
            <p className="text-xs text-gray-500">選擇要工作的組織</p>
          </div>
          
          <DropdownMenuSeparator />
          
          {organizations.map((userOrg) => (
            <DropdownMenuItem
              key={userOrg.organization.id}
              onClick={() => switchOrganization(userOrg.organization.id)}
              className="flex items-center justify-between px-2 py-2"
            >
              <div className="flex items-center space-x-2">
                <Building2 className="h-4 w-4" />
                <div className="flex flex-col">
                  <span className="text-sm font-medium">
                    {userOrg.organization.name}
                  </span>
                  {userOrg.organization.description && (
                    <span className="text-xs text-gray-500">
                      {userOrg.organization.description}
                    </span>
                  )}
                </div>
              </div>
              
              {currentOrganization.id === userOrg.organization.id && (
                <Badge variant="secondary" className="text-xs">
                  目前
                </Badge>
              )}
              
              {userOrg.organization.owner_id === userOrg.user_id && (
                <Badge variant="outline" className="text-xs">
                  擁有者
                </Badge>
              )}
            </DropdownMenuItem>
          ))}
          
          <DropdownMenuSeparator />
          
          <DropdownMenuItem className="flex items-center space-x-2 px-2 py-2">
            <Settings className="h-4 w-4" />
            <span className="text-sm">組織設定</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  );
};
