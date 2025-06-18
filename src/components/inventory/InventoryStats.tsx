
import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Package, AlertTriangle, TrendingUp, Archive } from 'lucide-react';

interface InventoryStatsProps {
  totalProducts: number;
  totalStock: number;
  totalRolls: number;
  lowStockItems: number;
}

export const InventoryStats = ({ totalProducts, totalStock, totalRolls, lowStockItems }: InventoryStatsProps) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">產品種類</p>
              <p className="text-2xl font-bold text-gray-900">{totalProducts}</p>
            </div>
            <Package className="h-8 w-8 text-blue-600" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">總庫存</p>
              <p className="text-2xl font-bold text-gray-900">{totalStock.toFixed(1)} KG</p>
            </div>
            <Archive className="h-8 w-8 text-green-600" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">總卷數</p>
              <p className="text-2xl font-bold text-gray-900">{totalRolls}</p>
            </div>
            <TrendingUp className="h-8 w-8 text-purple-600" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">庫存警告</p>
              <p className="text-2xl font-bold text-gray-900">{lowStockItems}</p>
            </div>
            <AlertTriangle className="h-8 w-8 text-orange-600" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
