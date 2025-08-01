
import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Building2, Users, Settings, Shield } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useToast } from '@/hooks/use-toast';
import { useOrganizationContext } from '@/contexts/OrganizationContext';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

interface CreateOrganizationForm {
  name: string;
  description?: string;
}

const CreateOrganization = () => {
  const { register, handleSubmit, formState: { isSubmitting }, reset } = useForm<CreateOrganizationForm>();
  const { toast } = useToast();
  const { createOrganization } = useOrganizationContext();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [isCreating, setIsCreating] = useState(false);

  // 如果還在載入認證狀態，顯示載入畫面
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-600">載入中...</p>
        </div>
      </div>
    );
  }

  // 如果用戶未登入，重定向到登入頁面
  if (!user) {
    console.log('CreateOrganization: No user, redirecting to login');
    navigate('/login', { replace: true });
    return null;
  }

  const onSubmit = async (data: CreateOrganizationForm) => {
    // 防止重複提交
    if (isCreating || isSubmitting) {
      console.log('Already creating organization, skipping...');
      return;
    }

    try {
      setIsCreating(true);
      console.log('Submitting organization creation:', data);
      console.log('Current user:', user);
      
      // 驗證表單數據
      if (!data.name || data.name.trim() === '') {
        toast({
          title: "創建組織失敗",
          description: "組織名稱不能為空",
          variant: "destructive",
        });
        return;
      }
      
      const result = await createOrganization(data.name.trim(), data.description?.trim());
      console.log('Organization created successfully:', result);
      
      toast({
        title: "組織創建成功",
        description: "您的組織已成功創建，正在為您設置系統...",
      });
      
      // 清除表單
      reset();
      
      // 延遲導航，讓使用者看到成功訊息，然後直接回到首頁讓路由系統處理
      setTimeout(() => {
        navigate('/', { replace: true });
      }, 1500);
    } catch (error: any) {
      console.error('Error creating organization:', error);
      
      let errorMessage = "請稍後再試或聯繫系統管理員";
      
      if (error?.code === '42501') {
        errorMessage = "權限不足，請重新登入後再嘗試";
      } else if (error?.message) {
        errorMessage = error.message;
      } else if (error?.details) {
        errorMessage = error.details;
      } else if (error?.hint) {
        errorMessage = error.hint;
      }
      
      toast({
        title: "創建組織失敗",
        description: errorMessage,
        variant: "destructive",
      });
      
      // 如果是權限錯誤，建議重新登入
      if (error?.code === '42501') {
        setTimeout(() => {
          navigate('/login', { replace: true });
        }, 2000);
      }
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-2xl w-full space-y-8">
        {/* 歡迎標題 */}
        <div className="text-center">
          <Building2 className="mx-auto h-12 w-12 text-blue-600" />
          <h1 className="mt-4 text-3xl font-bold text-gray-900">歡迎使用系統</h1>
          <p className="mt-2 text-gray-600">
            開始使用前，請為您的團隊創建一個組織
          </p>
        </div>

        {/* 功能介紹 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="text-center">
            <CardContent className="pt-6">
              <Users className="mx-auto h-8 w-8 text-blue-600 mb-2" />
              <h3 className="font-semibold">團隊協作</h3>
              <p className="text-sm text-gray-600">邀請團隊成員，共同管理業務</p>
            </CardContent>
          </Card>
          
          <Card className="text-center">
            <CardContent className="pt-6">
              <Settings className="mx-auto h-8 w-8 text-green-600 mb-2" />
              <h3 className="font-semibold">靈活管理</h3>
              <p className="text-sm text-gray-600">自定義角色和權限設定</p>
            </CardContent>
          </Card>
          
          <Card className="text-center">
            <CardContent className="pt-6">
              <Shield className="mx-auto h-8 w-8 text-purple-600 mb-2" />
              <h3 className="font-semibold">安全隔離</h3>
              <p className="text-sm text-gray-600">組織間數據完全隔離</p>
            </CardContent>
          </Card>
        </div>

        {/* 創建組織表單 */}
        <Card>
          <CardHeader>
            <CardTitle>創建您的組織</CardTitle>
            <CardDescription>
              您將成為該組織的擁有者，擁有完整的管理權限
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">組織名稱 *</Label>
                <Input
                  id="name"
                  {...register('name', { 
                    required: '組織名稱為必填項',
                    minLength: { value: 1, message: '組織名稱不能為空' }
                  })}
                  placeholder="例如：我的公司"
                  className="text-lg"
                  disabled={isSubmitting || isCreating}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">組織描述</Label>
                <Textarea
                  id="description"
                  {...register('description')}
                  placeholder="簡單描述您的組織業務或團隊（可選）"
                  rows={3}
                  disabled={isSubmitting || isCreating}
                />
              </div>

              <Button 
                type="submit" 
                className="w-full bg-blue-600 hover:bg-blue-700 text-lg py-3"
                disabled={isSubmitting || isCreating}
              >
                {isSubmitting || isCreating ? '創建中...' : '創建組織並開始使用'}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* 說明文字 */}
        <div className="text-center text-sm text-gray-500">
          <p>創建組織後，您可以邀請團隊成員並設定他們的權限</p>
        </div>
      </div>
    </div>
  );
};

export default CreateOrganization;
