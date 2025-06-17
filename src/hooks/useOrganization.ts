
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

export interface Organization {
  id: string;
  name: string;
  description?: string;
  settings: Record<string, any>;
  owner_id: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserOrganization {
  id: string;
  user_id: string;
  organization_id: string;
  is_active: boolean;
  joined_at: string;
  organization: Organization;
}

export const useOrganization = () => {
  const { user } = useAuth();
  const [organizations, setOrganizations] = useState<UserOrganization[]>([]);
  const [currentOrganization, setCurrentOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      console.log('useOrganization: No user, clearing state');
      setOrganizations([]);
      setCurrentOrganization(null);
      setLoading(false);
      return;
    }

    console.log('useOrganization: User found, fetching organizations');
    fetchUserOrganizations();
  }, [user]);

  const fetchUserOrganizations = async () => {
    if (!user) return;

    try {
      setLoading(true);
      console.log('Fetching organizations for user:', user.id);
      
      const { data, error } = await supabase
        .from('user_organizations')
        .select(`
          id,
          user_id,
          organization_id,
          is_active,
          joined_at,
          organization:organizations(
            id,
            name,
            description,
            settings,
            owner_id,
            is_active,
            created_at,
            updated_at
          )
        `)
        .eq('user_id', user.id)
        .eq('is_active', true)
        .order('joined_at', { ascending: false });

      if (error) {
        console.error('Error fetching organizations:', error);
        throw error;
      }

      console.log('Fetched organizations:', data);
      const userOrgs = data as UserOrganization[];
      setOrganizations(userOrgs);

      // 設定當前組織（從 localStorage 獲取或使用第一個）
      const savedOrgId = localStorage.getItem('currentOrganizationId');
      let currentOrg = null;

      if (savedOrgId) {
        currentOrg = userOrgs.find(uo => uo.organization.id === savedOrgId)?.organization;
      }

      if (!currentOrg && userOrgs.length > 0) {
        currentOrg = userOrgs[0].organization;
      }

      console.log('Setting current organization:', currentOrg);
      setCurrentOrganization(currentOrg);
      if (currentOrg) {
        localStorage.setItem('currentOrganizationId', currentOrg.id);
      }
    } catch (error) {
      console.error('Error fetching user organizations:', error);
    } finally {
      setLoading(false);
    }
  };

  const switchOrganization = (organizationId: string) => {
    const userOrg = organizations.find(uo => uo.organization.id === organizationId);
    if (userOrg) {
      setCurrentOrganization(userOrg.organization);
      localStorage.setItem('currentOrganizationId', organizationId);
    }
  };

  const createOrganization = async (name: string, description?: string) => {
    if (!user) {
      throw new Error('用戶未登入');
    }

    try {
      console.log('Creating organization with user:', user.id);
      console.log('Organization data:', { name, description, owner_id: user.id });
      
      // 首先創建組織
      const { data: orgData, error: orgError } = await supabase
        .from('organizations')
        .insert({
          name,
          description,
          owner_id: user.id
        })
        .select()
        .single();

      if (orgError) {
        console.error('Error creating organization:', orgError);
        throw orgError;
      }

      console.log('Organization created successfully:', orgData);

      // 重新獲取組織列表以確保狀態更新
      await fetchUserOrganizations();
      
      return orgData;
    } catch (error) {
      console.error('Error in createOrganization:', error);
      throw error;
    }
  };

  const hasNoOrganizations = !loading && organizations.length === 0;

  return {
    organizations,
    currentOrganization,
    loading,
    hasNoOrganizations,
    switchOrganization,
    createOrganization,
    refreshOrganizations: fetchUserOrganizations
  };
};
