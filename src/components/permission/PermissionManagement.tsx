
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
  );
};
