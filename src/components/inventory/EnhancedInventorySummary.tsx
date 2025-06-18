
import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Package, TrendingDown, TrendingUp } from 'lucide-react';
import { useInventorySummary, InventorySummaryItem } from '@/hooks/useInventorySummary';
import { EnhancedTable, TableColumn } from '@/components/ui/enhanced-table';
import { StockBadge } from './StockBadge';

export const EnhancedInventorySummary = () => {
  const { inventoryData, loading, hasMore, searchTerm, loadMore, search } = useInventorySummary();

  const formatRollDetails = (details: string[] | null) => {
    if (!details || details.length === 0) return '0 kg';
    
    const values = details.map(d => parseFloat(d));
    return values.join(' + ') + ' = ' + values.reduce((sum, val) => sum + val, 0).toFixed(2) + ' kg';
  };

  const formatDetailsArray = (details: string[] | null, gradeName: string, rolls: number) => {
    if (!details || details.length === 0) return `${gradeName}: 0 卷 = 0 kg`;
    
    const values = details.map(d => parseFloat(d));
    const total = values.reduce((sum, val) => sum + val, 0);
    const calculation = values.join(' + ');
    
    return `${gradeName}: ${rolls} 卷 ${calculation} = ${total.toFixed(2)} kg`;
  };

  const getTotalStock = () => {
    return inventoryData.reduce((sum, item) => sum + item.total_stock, 0);
  };

  const getTotalRolls = () => {
    return inventoryData.reduce((sum, item) => sum + item.total_rolls, 0);
  };

  const getTotalPendingIn = () => {
    return inventoryData.reduce((sum, item) => sum + item.pending_in_quantity, 0);
  };

  const getTotalPendingOut = () => {
    return inventoryData.reduce((sum, item) => sum + item.pending_out_quantity, 0);
  };

  const columns: TableColumn[] = [
    {
      key: 'product_name',
      title: '產品名稱',
      sortable: true,
      filterable: false,
      render: (value) => <span className="font-medium">{value}</span>
    },
    {
      key: 'color',
      title: '顏色',
      sortable: true,
      filterable: false,
      render: (value) => value || '無'
    },
    {
      key: 'color_code',
      title: '色碼',
      sortable: false,
      filterable: false,
      render: (value) => value ? (
        <div className="flex items-center space-x-2">
          <div 
            className="w-4 h-4 rounded border border-gray-300"
            style={{ backgroundColor: value }}
          />
          <span className="text-sm">{value}</span>
        </div>
      ) : '無'
    },
    {
      key: 'total_stock',
      title: '總庫存',
      sortable: true,
      filterable: false,
      render: (value, row) => (
        <StockBadge 
          currentStock={value} 
          threshold={row.stock_thresholds} 
          type="stock" 
        />
      )
    },
    {
      key: 'total_rolls',
      title: '總卷數',
      sortable: true,
      filterable: false,
      render: (value, row) => (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-help hover:underline">{value}</span>
            </TooltipTrigger>
            <TooltipContent>
              <div className="text-sm">
                <div>{formatDetailsArray(row.a_grade_details, 'A 級', row.a_grade_rolls)}</div>
                <div>{formatDetailsArray(row.b_grade_details, 'B 級', row.b_grade_rolls)}</div>
                <div>{formatDetailsArray(row.c_grade_details, 'C 級', row.c_grade_rolls)}</div>
                <div>{formatDetailsArray(row.d_grade_details, 'D 級', row.d_grade_rolls)}</div>
                <div>{formatDetailsArray(row.defective_details, '瑕疵品', row.defective_rolls)}</div>
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )
    },
    {
      key: 'a_grade_stock',
      title: 'A級',
      sortable: true,
      filterable: false,
      render: (value, row) => (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-help hover:underline">{value.toFixed(2)} KG</span>
            </TooltipTrigger>
            <TooltipContent>
              <div className="text-sm">{formatRollDetails(row.a_grade_details)}</div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )
    },
    {
      key: 'b_grade_stock',
      title: 'B級',
      sortable: true,
      filterable: false,
      render: (value, row) => (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-help hover:underline">{value.toFixed(2)} KG</span>
            </TooltipTrigger>
            <TooltipContent>
              <div className="text-sm">{formatRollDetails(row.b_grade_details)}</div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )
    },
    {
      key: 'c_grade_stock',
      title: 'C級',
      sortable: true,
      filterable: false,
      render: (value, row) => (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-help hover:underline">{value.toFixed(2)} KG</span>
            </TooltipTrigger>
            <TooltipContent>
              <div className="text-sm">{formatRollDetails(row.c_grade_details)}</div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )
    },
    {
      key: 'd_grade_stock',
      title: 'D級',
      sortable: true,
      filterable: false,
      render: (value, row) => (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-help hover:underline">{value.toFixed(2)} KG</span>
            </TooltipTrigger>
            <TooltipContent>
              <div className="text-sm">{formatRollDetails(row.d_grade_details)}</div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )
    },
    {
      key: 'defective_stock',
      title: '瑕疵品',
      sortable: true,
      filterable: false,
      render: (value, row) => (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-help hover:underline">{value.toFixed(2)} KG</span>
            </TooltipTrigger>
            <TooltipContent>
              <div className="text-sm">{formatRollDetails(row.defective_details)}</div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )
    },
    {
      key: 'pending_in_quantity',
      title: '待入庫',
      sortable: true,
      filterable: false,
      render: (value) => <StockBadge currentStock={value} type="pending-in" />
    },
    {
      key: 'pending_out_quantity',
      title: '待出貨',
      sortable: true,
      filterable: false,
      render: (value) => <StockBadge currentStock={value} type="pending-out" />
    }
  ];

  if (loading && inventoryData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>庫存統計</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex justify-center py-8">
            <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* 統計卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <Package className="h-8 w-8 text-blue-600" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">總庫存重量</p>
                <p className="text-2xl font-bold text-gray-900">{getTotalStock().toFixed(2)} KG</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <TrendingUp className="h-8 w-8 text-green-600" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">總布卷數</p>
                <p className="text-2xl font-bold text-gray-900">{getTotalRolls()}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <TrendingUp className="h-8 w-8 text-orange-600" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">待入庫</p>
                <p className="text-2xl font-bold text-orange-600">{getTotalPendingIn().toFixed(2)} KG</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <TrendingDown className="h-8 w-8 text-blue-600" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">待出貨</p>
                <p className="text-2xl font-bold text-blue-600">{getTotalPendingOut().toFixed(2)} KG</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 詳細庫存表格 */}
      <Card>
        <CardHeader>
          <CardTitle>產品庫存明細</CardTitle>
          <CardDescription>
            按產品分類的詳細庫存信息，包含各等級庫存分布
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EnhancedTable
            columns={columns}
            data={inventoryData}
            loading={loading}
            hasMore={hasMore}
            searchTerm={searchTerm}
            onSearch={search}
            onLoadMore={loadMore}
            searchPlaceholder="搜尋產品名稱、顏色..."
            emptyMessage="暫無庫存數據"
          />
        </CardContent>
      </Card>
    </div>
  );
};
