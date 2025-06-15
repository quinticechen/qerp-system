
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Eye, EyeOff, LogIn, User } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    // 檢查是否已登入
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        navigate('/dashboard');
      }
    };
    checkAuth();
  }, [navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast({
        title: "登入失敗",
        description: "請輸入電子郵件和密碼",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      toast({
        title: "登入成功",
        description: "歡迎使用紡織業 ERP 系統",
      });

      navigate('/dashboard');
    } catch (error: any) {
      toast({
        title: "登入失敗",
        description: error.message || "請檢查您的電子郵件和密碼",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 relative overflow-hidden">
      {/* 背景裝飾 */}
      <div className="absolute inset-0 bg-gradient-to-br from-blue-600/5 via-indigo-600/5 to-purple-600/5"></div>
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse"></div>
      <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-indigo-500/10 rounded-full blur-3xl animate-pulse delay-1000"></div>
      
      {/* 主要內容 */}
      <div className="w-full max-w-md space-y-8 relative z-10 px-4">
        {/* Logo 和標題區域 */}
        <div className="text-center space-y-6">
          <div className="flex justify-center">
            <div className="w-20 h-20 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-3xl flex items-center justify-center shadow-2xl shadow-blue-500/30 ring-4 ring-white/20">
              <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center backdrop-blur-sm">
                <div className="w-8 h-8 bg-white rounded-xl flex items-center justify-center shadow-lg">
                  <div className="w-4 h-4 bg-gradient-to-br from-blue-600 to-indigo-600 rounded"></div>
                </div>
              </div>
            </div>
          </div>
          <div className="space-y-3">
            <h1 className="text-4xl font-bold bg-gradient-to-r from-slate-800 via-blue-800 to-indigo-800 bg-clip-text text-transparent">
              紡織業 ERP
            </h1>
            <p className="text-slate-600 text-lg font-medium">現代化企業資源管理系統</p>
          </div>
        </div>

        {/* 登入表單卡片 */}
        <Card className="backdrop-blur-xl bg-white/95 border-0 shadow-2xl shadow-blue-500/10 ring-1 ring-white/20">
          <CardHeader className="space-y-3 text-center pb-6">
            <CardTitle className="text-2xl font-bold text-slate-800 flex items-center justify-center gap-3">
              <div className="p-2 bg-blue-100 rounded-full">
                <User size={20} className="text-blue-600" />
              </div>
              登入系統
            </CardTitle>
            <CardDescription className="text-slate-600 text-base">
              請輸入您的帳號資訊以存取系統
            </CardDescription>
          </CardHeader>
          
          <CardContent className="space-y-6 pb-8">
            <form onSubmit={handleLogin} className="space-y-6">
              <div className="space-y-3">
                <Label htmlFor="email" className="text-sm font-semibold text-slate-700">
                  電子郵件
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="請輸入您的電子郵件"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-12 text-base bg-white border-2 border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 rounded-xl px-4 transition-all duration-200"
                  required
                />
              </div>
              
              <div className="space-y-3">
                <Label htmlFor="password" className="text-sm font-semibold text-slate-700">
                  密碼
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="請輸入您的密碼"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-12 text-base bg-white border-2 border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 rounded-xl px-4 pr-12 transition-all duration-200"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-blue-600 transition-colors duration-200 p-1"
                  >
                    {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
              </div>
              
              <div className="pt-4">
                <Button
                  type="submit"
                  className="w-full h-12 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-base font-semibold rounded-xl shadow-xl shadow-blue-500/25 hover:shadow-2xl hover:shadow-blue-500/30 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] active:scale-[0.98]"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <div className="flex items-center justify-center space-x-3">
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
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
            
            <div className="text-center border-t border-slate-100 pt-6">
              <a
                href="#"
                className="text-blue-600 hover:text-blue-700 text-sm font-semibold transition-colors duration-200 hover:underline decoration-2 underline-offset-4"
              >
                忘記密碼？點此重設
              </a>
            </div>
          </CardContent>
        </Card>

        {/* 底部資訊 */}
        <div className="text-center space-y-4">
          <div className="flex flex-wrap justify-center gap-2 text-xs">
            {[
              { role: '業務', color: 'bg-blue-100 text-blue-700' },
              { role: '助理', color: 'bg-green-100 text-green-700' },
              { role: '會計', color: 'bg-purple-100 text-purple-700' },
              { role: '倉庫管理員', color: 'bg-orange-100 text-orange-700' },
              { role: '高層', color: 'bg-indigo-100 text-indigo-700' }
            ].map(({ role, color }) => (
              <span 
                key={role} 
                className={`px-3 py-1 rounded-full font-medium ${color} border border-current/20`}
              >
                {role}
              </span>
            ))}
          </div>
          <p className="text-slate-500 text-sm font-medium">
            © 2025 紡織業 ERP 系統. 版權所有.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;
