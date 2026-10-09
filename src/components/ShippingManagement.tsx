
import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus } from 'lucide-react';
import { ShippingList } from './shipping/ShippingList';
import { CreateShippingDialog } from './shipping/CreateShippingDialog';
import { PendingShippingSection } from './inventory/PendingShippingSection';
import { PermissionGate } from '@/components/PermissionGate';

const ShippingManagement = () => {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [selectedShippingId, setSelectedShippingId] = useState<string | null>(null);

  // A newly created shipping opens in the list's dialog
  const handleCreateSuccess = (shipping: { id: string }) => setSelectedShippingId(shipping.id);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">出貨管理</h2>
        <PermissionGate permission="canCreateShipping">
          <Button 
            onClick={() => setIsCreateDialogOpen(true)}
            className="bg-blue-600 text-white hover:bg-blue-700 border-0 shadow-sm"
          >
            <Plus className="mr-2 h-4 w-4" />
            新增出貨單
          </Button>
        </PermissionGate>
      </div>
      
      <Tabs defaultValue="shippings" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="shippings" className="text-gray-900 data-[state=active]:text-gray-900 data-[state=inactive]:text-gray-600">出貨單</TabsTrigger>
          <TabsTrigger value="pending-shipping" className="text-gray-900 data-[state=active]:text-gray-900 data-[state=inactive]:text-gray-600">待出貨</TabsTrigger>
        </TabsList>
        
        <TabsContent value="shippings">
          <ShippingList selectedId={selectedShippingId} onSelectedIdChange={setSelectedShippingId} />
        </TabsContent>
        
        <TabsContent value="pending-shipping">
          <PendingShippingSection />
        </TabsContent>
      </Tabs>
      
      <CreateShippingDialog 
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        onSuccess={handleCreateSuccess}
      />

    </div>
  );
};

export default ShippingManagement;
