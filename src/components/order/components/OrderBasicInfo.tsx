import React from 'react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { Combobox } from '@/components/ui/combobox';
import { FactorySelector } from '../FactorySelector';

interface Customer {
  id: string;
  name: string;
}

interface OrderBasicInfoProps {
  generatedOrderNumber: string;
  selectedCustomer: string;
  onCustomerChange: (customerId: string) => void;
  selectedFactoryIds: string[];
  onFactoriesChange: (factoryIds: string[]) => void;
  customers: Customer[];
  onCreateCustomer: () => void;
  onCreateFactory: () => void;
  customerError?: string;
}

export const OrderBasicInfo: React.FC<OrderBasicInfoProps> = ({
  generatedOrderNumber,
  selectedCustomer,
  onCustomerChange,
  selectedFactoryIds,
  onFactoriesChange,
  customers,
  onCreateCustomer,
  onCreateFactory,
  customerError,
}) => {
  // Prepare customer options for combobox
  const customerOptions = customers?.map(customer => ({
    value: customer.id,
    label: customer.name,
  })) || [];

  return (
    <div className="space-y-6">
      {/* Order Number Preview */}
      <div className="bg-blue-50 p-4 rounded-lg">
        <Label className="text-gray-800 font-semibold">訂單編號 (自動生成)</Label>
        <div className="text-lg font-mono text-blue-800 mt-1">{generatedOrderNumber}</div>
        <div className="text-xs text-gray-600 mt-1">格式：年份K月份日期-流水號</div>
      </div>

      {/* Customer Selection */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-gray-800">客戶 *</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCreateCustomer}
          >
            <Plus className="h-4 w-4 mr-1" />
            新增客戶
          </Button>
        </div>
        <Combobox
          options={customerOptions}
          value={selectedCustomer}
          onValueChange={onCustomerChange}
          placeholder="選擇客戶..."
          searchPlaceholder="搜尋客戶..."
          emptyText="未找到客戶"
          className="w-full"
        />
        {customerError && (
          <p className="text-sm text-red-600">{customerError}</p>
        )}
      </div>

      {/* Factory Selection */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-gray-800">關聯工廠 (可選擇多個)</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCreateFactory}
          >
            <Plus className="h-4 w-4 mr-1" />
            新增工廠
          </Button>
        </div>
        <FactorySelector 
          selectedFactoryIds={selectedFactoryIds}
          onFactoriesChange={onFactoriesChange}
        />
      </div>
    </div>
  );
};