
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Eye, EyeOff, LogIn, User, Mail, UserPlus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('login');
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

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || !fullName) {
      toast({
        title: "註冊失敗",
        description: "請填寫所有必填欄位",
        variant: "destructive",
      });
      return;
    }

    if (password !== confirmPassword) {
      toast({
        title: "註冊失敗",
        description: "密碼確認不符",
        variant: "destructive",
      });
      return;
    }

    if (password.length < 6) {
      toast({
        title: "註冊失敗",
        description: "密碼至少需要 6 個字元",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/`,
          data: {
            full_name: fullName,
          }
        }
      });

      if (error) throw error;

      toast({
        title: "註冊成功",
        description: "請檢查您的電子郵件以確認帳戶",
      });

      // 清除表單並切換到登入頁面
      setEmail('');
      setPassword('');
      setConfirmPassword('');
      setFullName('');
      setActiveTab('login');
    } catch (error: any) {
      toast({
        title: "註冊失敗",
        description: error.message || "註冊過程中發生錯誤",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/dashboard`
        }
      });

      if (error) throw error;
    } catch (error: any) {
      toast({
        title: "Google 登入失敗",
        description: error.message || "Google 登入過程中發生錯誤",
        variant: "destructive",
      });
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 relative overflow-hidden m-0 p-0">
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

        {/* 登入/註冊表單卡片 */}
        <Card className="backdrop-blur-xl bg-white/95 border-0 shadow-2xl shadow-blue-500/10 ring-1 ring-white/20">
          <CardHeader className="space-y-3 text-center pb-6">
            <CardTitle className="text-2xl font-bold text-slate-800 flex items-center justify-center gap-3">
              <div className="p-2 bg-blue-100 rounded-full">
                <User size={20} className="text-blue-600" />
              </div>
              歡迎使用系統
            </CardTitle>
            <CardDescription className="text-slate-600 text-base">
              請登入或註冊以存取系統
            </CardDescription>
          </CardHeader>
          
          <CardContent className="space-y-6 pb-8">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="login" className="flex items-center gap-2">
                  <LogIn size={16} />
                  登入
                </TabsTrigger>
                <TabsTrigger value="signup" className="flex items-center gap-2">
                  <UserPlus size={16} />
                  註冊
                </TabsTrigger>
              </TabsList>

              <TabsContent value="login" className="space-y-4 mt-6">
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-2">
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
                  
                  <div className="space-y-2">
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
                  
                  <div className="pt-2">
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
              </TabsContent>

              <TabsContent value="signup" className="space-y-4 mt-6">
                <form onSubmit={handleSignUp} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="fullName" className="text-sm font-semibold text-slate-700">
                      姓名
                    </Label>
                    <Input
                      id="fullName"
                      type="text"
                      placeholder="請輸入您的姓名"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="h-12 text-base bg-white border-2 border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 rounded-xl px-4 transition-all duration-200"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="signup-email" className="text-sm font-semibold text-slate-700">
                      電子郵件
                    </Label>
                    <Input
                      id="signup-email"
                      type="email"
                      placeholder="請輸入您的電子郵件"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="h-12 text-base bg-white border-2 border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 rounded-xl px-4 transition-all duration-200"
                      required
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="signup-password" className="text-sm font-semibold text-slate-700">
                      密碼
                    </Label>
                    <div className="relative">
                      <Input
                        id="signup-password"
                        type={showPassword ? "text" : "password"}
                        placeholder="請輸入密碼（至少 6 個字元）"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="h-12 text-base bg-white border-2 border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 rounded-xl px-4 pr-12 transition-all duration-200"
                        required
                        minLength={6}
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

                  <div className="space-y-2">
                    <Label htmlFor="confirm-password" className="text-sm font-semibold text-slate-700">
                      確認密碼
                    </Label>
                    <div className="relative">
                      <Input
                        id="confirm-password"
                        type={showConfirmPassword ? "text" : "password"}
                        placeholder="請再次輸入密碼"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="h-12 text-base bg-white border-2 border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 rounded-xl px-4 pr-12 transition-all duration-200"
                        required
                        minLength={6}
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-blue-600 transition-colors duration-200 p-1"
                      >
                        {showConfirmPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                      </button>
                    </div>
                  </div>
                  
                  <div className="pt-2">
                    <Button
                      type="submit"
                      className="w-full h-12 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white text-base font-semibold rounded-xl shadow-xl shadow-green-500/25 hover:shadow-2xl hover:shadow-green-500/30 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] active:scale-[0.98]"
                      disabled={isLoading}
                    >
                      {isLoading ? (
                        <div className="flex items-center justify-center space-x-3">
                          <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                          <span>註冊中...</span>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center space-x-2">
                          <UserPlus size={20} />
                          <span>建立帳戶</span>
                        </div>
                      )}
                    </Button>
                  </div>
                </form>
              </TabsContent>
            </Tabs>

            {/* Google 登入按鈕 */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-slate-200" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-white px-2 text-slate-500">或使用</span>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={handleGoogleLogin}
              disabled={isLoading}
              className="w-full h-12 border-2 border-slate-300 hover:border-blue-500 text-slate-700 hover:text-blue-600 text-base font-semibold rounded-xl transition-all duration-300 transform hover:scale-[1.02] active:scale-[0.98]"
            >
              <div className="flex items-center justify-center space-x-3">
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                <span>使用 Google 登入</span>
              </div>
            </Button>
            
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
