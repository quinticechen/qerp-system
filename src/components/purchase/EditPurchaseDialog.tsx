
import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface EditPurchaseDialogProps {
  purchase: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const EditPurchaseDialog = ({ purchase, open, onOpenChange }: EditPurchaseDialogProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [formData, setFormData] = useState({
    expected_arrival_date: '',
    note: '',
    status: 'pending' as 'pending' | 'confirmed' | 'partial_arrived' | 'completed' | 'cancelled'
  });

  useEffect(() => {
    if (purchase) {
      setFormData({
        expected_arrival_date: purchase.expected_arrival_date || '',
        note: purchase.note || '',
        status: purchase.status || 'pending'
      });
    }
  }, [purchase]);

  const updatePurchaseMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('purchase_orders')
        .update({
          expected_arrival_date: formData.expected_arrival_date || null,
          note: formData.note || null,
          status: formData.status
        })
        .eq('id', purchase.id);

      if (error) throw error;
    },
    onSuccess: () => {
      toast({
        title: "成功",
        description: "採購單已更新"
      });
      queryClient.invalidateQueries({ queryKey: ['purchases'] });
      onOpenChange(false);
    },
    onError: (error) => {
      toast({
        title: "錯誤",
        description: "更新採購單失敗",
        variant: "destructive"
      });
      console.error('Error updating purchase:', error);
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updatePurchaseMutation.mutate();
  };

  if (!purchase) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-gray-900">編輯採購單</DialogTitle>
          <DialogDescription className="text-gray-600">
            編輯採購單 {purchase.po_number} 的資訊
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="status" className="text-gray-700">狀態</Label>
            <Select value={formData.status} onValueChange={(value: 'pending' | 'confirmed' | 'partial_arrived' | 'completed' | 'cancelled') => setFormData({...formData, status: value})}>
              <SelectTrigger className="border-gray-300 focus:border-blue-500 focus:ring-blue-500">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">待確認</SelectItem>
                <SelectItem value="confirmed">已下單</SelectItem>
                <SelectItem value="partial_arrived">部分到貨</SelectItem>
                <SelectItem value="completed">已完成</SelectItem>
                <SelectItem value="cancelled">已取消</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="expected_arrival_date" className="text-gray-700">預計到貨日期</Label>
            <Input
              id="expected_arrival_date"
              type="date"
              value={formData.expected_arrival_date}
              onChange={(e) => setFormData({...formData, expected_arrival_date: e.target.value})}
              className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="note" className="text-gray-700">備註</Label>
            <Textarea
              id="note"
              placeholder="輸入備註..."
              value={formData.note}
              onChange={(e) => setFormData({...formData, note: e.target.value})}
              className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              取消
            </Button>
            <Button
              type="submit"
              disabled={updatePurchaseMutation.isPending}
              className="bg-blue-600 text-white hover:bg-blue-700"
            >
              {updatePurchaseMutation.isPending ? '更新中...' : '更新'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
