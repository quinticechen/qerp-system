
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
  const { user, loading: authLoading } = useAuth();
  const [organizations, setOrganizations] = useState<UserOrganization[]>([]);
  const [currentOrganization, setCurrentOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) {
      console.log('useOrganization: Auth still loading, waiting...');
      return;
    }

    if (!user) {
      console.log('useOrganization: No user, clearing state');
      setOrganizations([]);
      setCurrentOrganization(null);
      setLoading(false);
      return;
    }

    console.log('useOrganization: User found, fetching organizations');
    fetchUserOrganizations();
  }, [user, authLoading]);

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
      // A membership whose organization has been soft-deleted (organizations.is_active = false)
      // comes back with organization: null, since RLS blocks the embedded row — filter those out
      // rather than letting the rest of this function dereference a null organization.
      const userOrgs = (data as UserOrganization[]).filter((uo) => !!uo.organization);
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
      
      // 檢查當前用戶的認證狀態
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session) {
        console.error('Session error:', sessionError);
        throw new Error('認證會話無效，請重新登入');
      }
      
      console.log('Current session user:', session.user.id);
      
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

      // 立即把新建立的組織設成目前組織。不先做這一步的話，若瀏覽器裡已經存有
      // 指向其他組織的 currentOrganizationId（任何不是第一次使用的使用者都會
      // 有這個情況），下面的 fetchUserOrganizations() 會沿用舊的偏好設定，
      // 使用者建立新組織後畫面還是停在原本的組織，而不是新組織的儀表板。
      localStorage.setItem('currentOrganizationId', orgData.id);

      // 等待一下讓觸發器完成
      await new Promise(resolve => setTimeout(resolve, 1000));

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
