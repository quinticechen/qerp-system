
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Plus, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Order {
  id: string;
  order_number: string;
  note?: string;
}

interface OrderSelectorProps {
  orders?: Order[];
  selectedOrderIds: string[];
  setSelectedOrderIds: (ids: string[]) => void;
  orderSearchOpen: boolean;
  setOrderSearchOpen: (open: boolean) => void;
}

export const OrderSelector: React.FC<OrderSelectorProps> = ({
  orders,
  selectedOrderIds,
  setSelectedOrderIds,
  orderSearchOpen,
  setOrderSearchOpen,
}) => {
  const handleOrderSelection = (orderId: string) => {
    if (!selectedOrderIds.includes(orderId)) {
      setSelectedOrderIds([...selectedOrderIds, orderId]);
    }
    setOrderSearchOpen(false);
  };

  const removeOrder = (orderId: string) => {
    setSelectedOrderIds(selectedOrderIds.filter(id => id !== orderId));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-gray-900 flex items-center justify-between">
          關聯訂單 (可選擇多個)
          <Popover open={orderSearchOpen} onOpenChange={setOrderSearchOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="ml-2">
                <Plus className="h-4 w-4 mr-1" />
                搜尋並添加訂單
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0">
              <Command>
                <CommandInput placeholder="搜尋訂單編號..." className="h-9" />
                <CommandList>
                  <CommandEmpty>未找到訂單。</CommandEmpty>
                  <CommandGroup>
                    {orders?.map((order) => (
                      <CommandItem
                        key={order.id}
                        value={order.order_number}
                        onSelect={() => handleOrderSelection(order.id)}
                        className="cursor-pointer hover:bg-gray-100"
                      >
                        <div className="flex flex-col flex-1">
                          <span>{order.order_number}</span>
                          {order.note && (
                            <span className="text-xs text-gray-500">{order.note}</span>
                          )}
                        </div>
                        <Check
                          className={cn(
                            "ml-auto h-4 w-4",
                            selectedOrderIds.includes(order.id) ? "opacity-100" : "opacity-0"
                          )}
                        />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {selectedOrderIds.length > 0 ? (
          selectedOrderIds.map((orderId) => {
            const order = orders?.find(o => o.id === orderId);
            return (
              <div key={orderId} className="flex items-center justify-between p-2 bg-blue-50 rounded">
                <div>
                  <span className="text-gray-800 font-medium">{order?.order_number}</span>
                  {order?.note && (
                    <div className="text-sm text-gray-600 mt-1">{order.note}</div>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => removeOrder(orderId)}
                  className="text-red-600 hover:text-red-700"
                >
                  移除
                </Button>
              </div>
            );
          })
        ) : (
          <div className="text-gray-500 text-sm">尚未選擇訂單</div>
        )}
      </CardContent>
    </Card>
  );
};
