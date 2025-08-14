import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { FactoryList } from './factory/FactoryList';
import { CreateFactoryDialog } from './common/CreateFactoryDialog';

const FactoryManagement = () => {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  const handleFactoryCreated = () => {
    // This will be handled by the FactoryList component's refetch
    setIsCreateDialogOpen(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">工廠管理</h2>
        <Button 
          onClick={() => setIsCreateDialogOpen(true)}
          className="bg-blue-600 text-white hover:bg-blue-700 border-0 shadow-sm"
        >
          <Plus className="mr-2 h-4 w-4" />
          新增工廠
        </Button>
      </div>
      
      <FactoryList />
      
      <CreateFactoryDialog 
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        onFactoryCreated={handleFactoryCreated}
      />
    </div>
  );
};

export default FactoryManagement;