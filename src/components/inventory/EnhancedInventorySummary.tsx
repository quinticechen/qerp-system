
import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Package, TrendingDown, TrendingUp } from 'lucide-react';
import { useInventorySummary, InventorySummaryItem } from '@/hooks/useInventorySummary';

export const EnhancedInventorySummary = () => {
  const { inventoryData, loading, hasMore, searchTerm, loadMore, search } = useInventorySummary();
  const [localSearchTerm, setLocalSearchTerm] = useState(searchTerm);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    search(localSearchTerm);
  };

  const getStockBackgroundColor = (currentStock: number, threshold: number | null) => {
    if (!threshold) return '';
    
    if (currentStock > threshold) return 'bg-green-100';
    if (currentStock === threshold) return 'bg-yellow-100';
    if (currentStock < threshold) return 'bg-red-100';
    
    return '';
  };

  const formatDetailsArray = (details: string[] | null, gradeName: string, rolls: number) => {
    if (!details || details.length === 0) return `${gradeName}: 0 卷 = 0 kg`;
    
    const values = details.map(d => parseFloat(d));
    const total = values.reduce((sum, val) => sum + val, 0);
    const calculation = values.join(' + ');
    
    return `${gradeName}: ${rolls} 卷 ${calculation} = ${total.toFixed(2)} kg`;
  };

  const formatRollDetails = (details: string[] | null) => {
    if (!details || details.length === 0) return '0 kg';
    
    const values = details.map(d => parseFloat(d));
    return values.join(' + ') + ' = ' + values.reduce((sum, val) => sum + val, 0).toFixed(2) + ' kg';
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
          {/* 搜尋控制 */}
          <div className="mb-4">
            <form onSubmit={handleSearchSubmit} className="flex gap-2">
              <Input
                placeholder="搜尋產品名稱、顏色..."
                value={localSearchTerm}
                onChange={(e) => setLocalSearchTerm(e.target.value)}
                className="flex-1"
              />
              <Button type="submit" variant="outline">搜尋</Button>
            </form>
          </div>

          {inventoryData.length === 0 ? (
            <div className="text-center py-8">
              <Package size={48} className="mx-auto text-gray-400 mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">暫無庫存數據</h3>
              <p className="text-gray-600">請先進行入庫操作</p>
            </div>
          ) : (
            <TooltipProvider>
              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>產品名稱</TableHead>
                      <TableHead>顏色</TableHead>
                      <TableHead>色碼</TableHead>
                      <TableHead className="text-right">總庫存</TableHead>
                      <TableHead className="text-right">總卷數</TableHead>
                      <TableHead className="text-right">A級</TableHead>
                      <TableHead className="text-right">B級</TableHead>
                      <TableHead className="text-right">C級</TableHead>
                      <TableHead className="text-right">D級</TableHead>
                      <TableHead className="text-right">瑕疵品</TableHead>
                      <TableHead className="text-right">待入庫</TableHead>
                      <TableHead className="text-right">待出貨</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inventoryData.map((item) => (
                      <TableRow key={`${item.product_id}-${item.color || 'default'}`}>
                        <TableCell className="font-medium">{item.product_name}</TableCell>
                        <TableCell>{item.color || '無'}</TableCell>
                        <TableCell>
                          {item.color_code ? (
                            <div className="flex items-center space-x-2">
                              <div 
                                className="w-4 h-4 rounded border border-gray-300"
                                style={{ backgroundColor: item.color_code }}
                              />
                              <span className="text-sm">{item.color_code}</span>
                            </div>
                          ) : (
                            '無'
                          )}
                        </TableCell>
                        <TableCell className={`text-right ${getStockBackgroundColor(item.total_stock, item.stock_thresholds)} px-2 py-1 rounded`}>
                          {item.total_stock.toFixed(2)} KG
                        </TableCell>
                        <TableCell className="text-right">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-help hover:underline">
                                {item.total_rolls}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              <div className="text-sm">
                                <div>{formatDetailsArray(item.a_grade_details, 'A 級', item.a_grade_rolls)}</div>
                                <div>{formatDetailsArray(item.b_grade_details, 'B 級', item.b_grade_rolls)}</div>
                                <div>{formatDetailsArray(item.c_grade_details, 'C 級', item.c_grade_rolls)}</div>
                                <div>{formatDetailsArray(item.d_grade_details, 'D 級', item.d_grade_rolls)}</div>
                                <div>{formatDetailsArray(item.defective_details, '瑕疵品', item.defective_rolls)}</div>
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </TableCell>
                        <TableCell className="text-right">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-help hover:underline">
                                {item.a_grade_stock.toFixed(2)} KG
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              <div className="text-sm">
                                {formatRollDetails(item.a_grade_details)}
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </TableCell>
                        <TableCell className="text-right">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-help hover:underline">
                                {item.b_grade_stock.toFixed(2)} KG
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              <div className="text-sm">
                                {formatRollDetails(item.b_grade_details)}
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </TableCell>
                        <TableCell className="text-right">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-help hover:underline">
                                {item.c_grade_stock.toFixed(2)} KG
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              <div className="text-sm">
                                {formatRollDetails(item.c_grade_details)}
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </TableCell>
                        <TableCell className="text-right">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-help hover:underline">
                                {item.d_grade_stock.toFixed(2)} KG
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              <div className="text-sm">
                                {formatRollDetails(item.d_grade_details)}
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </TableCell>
                        <TableCell className="text-right">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-help hover:underline">
                                {item.defective_stock.toFixed(2)} KG
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              <div className="text-sm">
                                {formatRollDetails(item.defective_details)}
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </TableCell>
                        <TableCell className="text-right text-orange-600">
                          {item.pending_in_quantity.toFixed(2)} KG
                        </TableCell>
                        <TableCell className="text-right text-blue-600">
                          {item.pending_out_quantity.toFixed(2)} KG
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* 載入更多按鈕 */}
              {hasMore && (
                <div className="flex justify-center pt-4">
                  <Button 
                    variant="outline" 
                    onClick={loadMore}
                    disabled={loading}
                  >
                    {loading ? '載入中...' : '載入更多'}
                  </Button>
                </div>
              )}
            </TooltipProvider>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
