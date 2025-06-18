
import React, { createContext, useContext, ReactNode } from 'react';
import { useOrganization, Organization, UserOrganization } from '@/hooks/useOrganization';

interface OrganizationContextType {
  organizations: UserOrganization[];
  currentOrganization: Organization | null;
  loading: boolean;
  hasNoOrganizations: boolean;
  switchOrganization: (organizationId: string) => void;
  createOrganization: (name: string, description?: string) => Promise<any>;
  refreshOrganizations: () => Promise<void>;
}

const OrganizationContext = createContext<OrganizationContextType | undefined>(undefined);

export const OrganizationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const organizationData = useOrganization();

  return (
    <OrganizationContext.Provider value={organizationData}>
      {children}
    </OrganizationContext.Provider>
  );
};

export const useOrganizationContext = () => {
  const context = useContext(OrganizationContext);
  if (context === undefined) {
    throw new Error('useOrganizationContext must be used within an OrganizationProvider');
  }
  return context;
};
