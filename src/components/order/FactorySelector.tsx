
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Combobox } from '@/components/ui/combobox';
import { X, Plus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useCurrentOrganization } from '@/hooks/useCurrentOrganization';

interface Factory {
  id: string;
  name: string;
}

interface FactorySelectorProps {
  selectedFactoryIds: string[];
  onFactoriesChange: (factoryIds: string[]) => void;
}

export const FactorySelector: React.FC<FactorySelectorProps> = ({
  selectedFactoryIds,
  onFactoriesChange,
}) => {
  const { organizationId } = useCurrentOrganization();
  
  const { data: factories } = useQuery({
    queryKey: ['factories', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      
      const { data, error } = await supabase
        .from('factories')
        .select('id, name')
        .eq('organization_id', organizationId)
        .order('name');
      
      if (error) throw error;
      return data as Factory[];
    },
    enabled: !!organizationId
  });

  const handleAddFactory = (factoryId: string) => {
    if (!selectedFactoryIds.includes(factoryId)) {
      onFactoriesChange([...selectedFactoryIds, factoryId]);
    }
  };

  const handleRemoveFactory = (factoryId: string) => {
    onFactoriesChange(selectedFactoryIds.filter(id => id !== factoryId));
  };

  const availableFactories = factories?.filter(
    factory => !selectedFactoryIds.includes(factory.id)
  ) || [];

  const selectedFactories = factories?.filter(
    factory => selectedFactoryIds.includes(factory.id)
  ) || [];

  const factoryOptions = availableFactories.map(factory => ({
    value: factory.id,
    label: factory.name,
  }));

  return (
    <Card>
      <CardContent className="space-y-4 pt-4">
        {/* Factory Selection Dropdown */}
        <div className="space-y-2">
          <Combobox
            options={factoryOptions}
            onValueChange={handleAddFactory}
            placeholder="選擇工廠..."
            searchPlaceholder="搜尋工廠..."
            emptyText="未找到工廠"
            className="w-full"
          />
        </div>
        
        {/* Selected Factories Display */}
        {selectedFactories.length > 0 ? (
          <div className="space-y-2">
            <div className="text-sm font-medium text-gray-700">已選擇的工廠：</div>
            {selectedFactories.map((factory) => (
              <div key={factory.id} className="flex items-center justify-between p-2 bg-blue-50 rounded">
                <span className="text-gray-800">{factory.name}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleRemoveFactory(factory.id)}
                  className="text-red-600 hover:text-red-700"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-gray-500 text-sm">尚未選擇工廠</div>
        )}
      </CardContent>
    </Card>
  );
};
