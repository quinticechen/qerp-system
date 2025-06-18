
import { useOrganizationContext } from '@/contexts/OrganizationContext';

export const useCurrentOrganization = () => {
  const { currentOrganization } = useOrganizationContext();
  
  return {
    organizationId: currentOrganization?.id,
    organization: currentOrganization,
    hasOrganization: !!currentOrganization
  };
};
