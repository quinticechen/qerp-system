
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    // 模擬登入過程
    setTimeout(() => {
      setIsLoading(false);
      if (email && password) {
        toast({
          title: "登入成功",
          description: "歡迎使用紡織業 ERP 系統",
        });
      } else {
        toast({
          title: "登入失敗",
          description: "請檢查您的電子郵件和密碼",
          variant: "destructive",
        });
      }
    }, 1500);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 relative overflow-hidden">
      {/* 背景裝飾元素 */}
      <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg%20width=%2260%22%20height=%2260%22%20viewBox=%220%200%2060%2060%22%20xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cg%20fill=%22none%22%20fill-rule=%22evenodd%22%3E%3Cg%20fill=%22%23ffffff%22%20fill-opacity=%220.03%22%3E%3Cpath%20d=%22M36%2034v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6%2034v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6%204V0H4v4H0v2h4v4h2V6h4V4H6z%22/%3E%3C/g%3E%3C/g%3E%3C/svg%3E')] opacity-20"></div>
      
      {/* 主要內容 */}
      <div className="w-full max-w-md space-y-8 relative z-10">
        {/* Logo 和標題區域 */}
        <div className="text-center space-y-4">
          <div className="flex justify-center">
            <div className="w-16 h-16 bg-gradient-to-br from-blue-400 to-blue-600 rounded-2xl flex items-center justify-center shadow-2xl">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-bold text-white">紡織業 ERP 系統</h1>
            <p className="text-blue-200">整合性企業資源管理平台</p>
          </div>
        </div>

        {/* 登入表單卡片 */}
        <Card className="bg-white/10 backdrop-blur-lg border-white/20 shadow-2xl">
          <CardHeader className="space-y-2 text-center">
            <CardTitle className="text-2xl text-white">歡迎回來</CardTitle>
            <CardDescription className="text-blue-100">
              請輸入您的帳號資訊以登入系統
            </CardDescription>
          </CardHeader>
          
          <CardContent>
            <Tabs defaultValue="login" className="space-y-4">
              <TabsList className="grid w-full grid-cols-1 bg-white/10 border-white/20">
                <TabsTrigger value="login" className="text-white data-[state=active]:bg-white/20 data-[state=active]:text-white">
                  登入
                </TabsTrigger>
              </TabsList>
              
              <TabsContent value="login" className="space-y-4">
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-white text-sm font-medium">
                      電子郵件
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="請輸入您的電子郵件"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="bg-white/10 border-white/20 text-white placeholder:text-blue-200 focus:border-blue-400 focus:ring-blue-400"
                      required
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="password" className="text-white text-sm font-medium">
                      密碼
                    </Label>
                    <Input
                      id="password"
                      type="password"
                      placeholder="請輸入您的密碼"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="bg-white/10 border-white/20 text-white placeholder:text-blue-200 focus:border-blue-400 focus:ring-blue-400"
                      required
                    />
                  </div>
                  
                  <Button
                    type="submit"
                    className="w-full bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-medium py-3 rounded-lg transition-all duration-200 transform hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <div className="flex items-center justify-center space-x-2">
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        <span>登入中...</span>
                      </div>
                    ) : (
                      '登入系統'
                    )}
                  </Button>
                </form>
                
                <div className="text-center">
                  <a
                    href="#"
                    className="text-blue-200 hover:text-white text-sm transition-colors duration-200"
                  >
                    忘記密碼？
                  </a>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* 底部資訊 */}
        <div className="text-center space-y-2">
          <p className="text-blue-200 text-sm">
            支援角色：業務 | 助理 | 會計 | 倉庫管理員 | 高層
          </p>
          <p className="text-blue-300/60 text-xs">
            © 2025 紡織業 ERP 系統. 版權所有.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;
