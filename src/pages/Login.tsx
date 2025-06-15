
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Eye, EyeOff, LogIn, User } from 'lucide-react';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-slate-100 dark:from-slate-900 dark:via-blue-900 dark:to-slate-900 relative overflow-hidden">
      {/* 背景裝飾圓圈 */}
      <div className="absolute top-0 left-0 w-96 h-96 bg-gradient-to-br from-blue-400/30 to-blue-600/30 rounded-full blur-3xl -translate-x-48 -translate-y-48"></div>
      <div className="absolute bottom-0 right-0 w-96 h-96 bg-gradient-to-tl from-blue-500/20 to-blue-700/20 rounded-full blur-3xl translate-x-48 translate-y-48"></div>
      
      {/* 主要內容 */}
      <div className="w-full max-w-md space-y-8 relative z-10 px-4">
        {/* Logo 和標題區域 */}
        <div className="text-center space-y-6">
          <div className="flex justify-center">
            <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-blue-700 rounded-3xl flex items-center justify-center shadow-2xl shadow-blue-500/25">
              <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center backdrop-blur-sm">
                <div className="w-8 h-8 bg-white rounded-xl flex items-center justify-center">
                  <div className="w-4 h-4 bg-blue-600 rounded"></div>
                </div>
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white">紡織業 ERP</h1>
            <p className="text-slate-600 dark:text-slate-400">現代化企業資源管理系統</p>
          </div>
        </div>

        {/* 登入表單卡片 */}
        <Card className="card-elevated backdrop-blur-sm bg-white/80 dark:bg-slate-800/80 border-white/50 dark:border-slate-700/50 shadow-2xl shadow-blue-500/10">
          <CardHeader className="space-y-2 text-center pb-4">
            <CardTitle className="text-2xl text-slate-900 dark:text-white flex items-center justify-center gap-2">
              <User size={24} className="text-blue-600" />
              登入系統
            </CardTitle>
            <CardDescription className="text-slate-600 dark:text-slate-400">
              請輸入您的帳號資訊
            </CardDescription>
          </CardHeader>
          
          <CardContent className="space-y-6">
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="form-label">
                  電子郵件
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="請輸入您的電子郵件"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="form-input h-12 text-base"
                  required
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="password" className="form-label">
                  密碼
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="請輸入您的密碼"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="form-input h-12 text-base pr-12"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors"
                  >
                    {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
              </div>
              
              <div className="pt-2">
                <Button
                  type="submit"
                  className="w-full h-12 btn-blue text-base font-medium rounded-xl shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/30 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <div className="flex items-center justify-center space-x-2">
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      <span>登入中...</span>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center space-x-2">
                      <LogIn size={20} />
                      <span>登入系統</span>
                    </div>
                  )}
                </Button>
              </div>
            </form>
            
            <div className="text-center border-t border-slate-200 dark:border-slate-700 pt-4">
              <a
                href="#"
                className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 text-sm font-medium transition-colors duration-200 hover:underline"
              >
                忘記密碼？
              </a>
            </div>
          </CardContent>
        </Card>

        {/* 底部資訊 */}
        <div className="text-center space-y-3">
          <div className="flex flex-wrap justify-center gap-2 text-xs">
            {['業務', '助理', '會計', '倉庫管理員', '高層'].map((role, index) => (
              <span key={role} className="badge-blue">
                {role}
              </span>
            ))}
          </div>
          <p className="text-slate-500 dark:text-slate-400 text-xs">
            © 2025 紡織業 ERP 系統. 版權所有.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;
