
import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

interface EditFactoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  factory: any;
  onFactoryUpdated: () => void;
}

export const EditFactoryDialog: React.FC<EditFactoryDialogProps> = ({
  open,
  onOpenChange,
  factory,
  onFactoryUpdated,
}) => {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    contact_person: '',
    phone: '',
    landline_phone: '',
    fax: '',
    email: '',
    address: '',
    note: ''
  });

  useEffect(() => {
    if (factory) {
      setFormData({
        name: factory.name || '',
        contact_person: factory.contact_person || '',
        phone: factory.phone || '',
        landline_phone: factory.landline_phone || '',
        fax: factory.fax || '',
        email: factory.email || '',
        address: factory.address || '',
        note: factory.note || ''
      });
    }
  }, [factory]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // 驗證必填欄位
    if (!formData.name.trim()) {
      toast.error('請輸入工廠名稱');
      return;
    }
    if (!formData.contact_person.trim()) {
      toast.error('請輸入聯絡人');
      return;
    }
    if (!formData.phone.trim() && !formData.landline_phone.trim()) {
      toast.error('請至少輸入一個電話號碼（手機或市話）');
      return;
    }
    
    setLoading(true);

    try {
      const { error } = await supabase
        .from('factories')
        .update(formData)
        .eq('id', factory.id);

      if (error) {
        console.error('Error updating factory:', error);
        throw error;
      }

      toast.success('工廠更新成功');
      onFactoryUpdated();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error updating factory:', error);
      toast.error('更新工廠失敗');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>編輯工廠</DialogTitle>
          <DialogDescription>
            編輯工廠資訊
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">工廠名稱 *</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="contact_person">聯絡人 *</Label>
            <Input
              id="contact_person"
              value={formData.contact_person}
              onChange={(e) => setFormData({ ...formData, contact_person: e.target.value })}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">手機 *</Label>
            <Input
              id="phone"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              placeholder="至少填寫手機或市話其中一個"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="landline_phone">市話 *</Label>
            <Input
              id="landline_phone"
              value={formData.landline_phone}
              onChange={(e) => setFormData({ ...formData, landline_phone: e.target.value })}
              placeholder="至少填寫手機或市話其中一個"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="fax">傳真</Label>
            <Input
              id="fax"
              value={formData.fax}
              onChange={(e) => setFormData({ ...formData, fax: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="address">地址</Label>
            <Textarea
              id="address"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="note">備註</Label>
            <Textarea
              id="note"
              value={formData.note}
              onChange={(e) => setFormData({ ...formData, note: e.target.value })}
              rows={3}
            />
          </div>

          <div className="flex gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="flex-1">
              取消
            </Button>
            <Button type="submit" disabled={loading} className="flex-1">
              {loading ? '更新中...' : '更新工廠'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
