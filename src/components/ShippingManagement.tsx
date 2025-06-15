
import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { ShippingList } from './shipping/ShippingList';
import { CreateShippingDialog } from './shipping/CreateShippingDialog';

const ShippingManagement = () => {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">出貨管理</h2>
        <Button 
          onClick={() => setIsCreateDialogOpen(true)}
          className="bg-blue-600 text-white hover:bg-blue-700 border-0 shadow-sm"
        >
          <Plus className="mr-2 h-4 w-4" />
          新增出貨單
        </Button>
      </div>
      
      <ShippingList />
      
      <CreateShippingDialog 
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
      />
    </div>
  );
};

export default ShippingManagement;
