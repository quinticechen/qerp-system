
import React, { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface EditShippingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shipping: any;
}

export const EditShippingDialog: React.FC<EditShippingDialogProps> = ({
  open,
  onOpenChange,
  shipping,
}) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [shippingDate, setShippingDate] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (shipping) {
      setShippingDate(shipping.shipping_date);
      setNote(shipping.note || '');
    }
  }, [shipping]);

  const updateShippingMutation = useMutation({
    mutationFn: async (updateData: {
      shipping_date: string;
      note: string;
    }) => {
      const { error } = await supabase
        .from('shippings')
        .update(updateData)
        .eq('id', shipping.id);

      if (error) throw error;
    },
    onSuccess: () => {
      toast({
        title: "成功",
        description: "出貨單已成功更新",
      });
      queryClient.invalidateQueries({ queryKey: ['shippings'] });
      onOpenChange(false);
    },
    onError: (error) => {
      console.error('Error updating shipping:', error);
      toast({
        title: "錯誤",
        description: "更新出貨單時發生錯誤",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = () => {
    updateShippingMutation.mutate({
      shipping_date: shippingDate,
      note,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-gray-900">編輯出貨單</DialogTitle>
          <DialogDescription className="text-gray-700">
            出貨單號: {shipping?.shipping_number}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="shipping_date" className="text-gray-800">出貨日期</Label>
            <Input
              id="shipping_date"
              type="date"
              value={shippingDate}
              onChange={(e) => setShippingDate(e.target.value)}
              className="border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="note" className="text-gray-800">備註</Label>
            <Textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="輸入備註..."
              className="border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="text-gray-700 border-gray-300 hover:bg-gray-50">
            取消
          </Button>
          <Button 
            onClick={handleSubmit}
            disabled={updateShippingMutation.isPending}
            className="bg-blue-600 text-white hover:bg-blue-700"
          >
            {updateShippingMutation.isPending ? '更新中...' : '更新出貨單'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
