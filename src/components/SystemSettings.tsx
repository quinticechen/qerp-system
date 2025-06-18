
import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Settings, Bell, Shield, Database, Users, Mail } from 'lucide-react';

const SystemSettings = () => {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-slate-800">系統設定</h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 通知設定 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Bell className="mr-2" size={20} />
              通知設定
            </CardTitle>
            <CardDescription>
              管理系統通知和警告設定
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-base">庫存低量警告</Label>
                <p className="text-sm text-muted-foreground">
                  當產品庫存低於設定閾值時發送通知
                </p>
              </div>
              <Switch />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-base">新訂單通知</Label>
                <p className="text-sm text-muted-foreground">
                  收到新訂單時即時通知相關人員
                </p>
              </div>
              <Switch />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-base">出貨提醒</Label>
                <p className="text-sm text-muted-foreground">
                  訂單需要出貨時提醒倉庫人員
                </p>
              </div>
              <Switch />
            </div>
          </CardContent>
        </Card>

        {/* 使用者權限 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Shield className="mr-2" size={20} />
              權限管理
            </CardTitle>
            <CardDescription>
              管理使用者角色和權限設定
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>預設新使用者角色</Label>
              <select className="w-full p-2 border border-input rounded-md">
                <option value="sales">業務</option>
                <option value="assistant">助理</option>
                <option value="accounting">會計</option>
                <option value="warehouse">倉庫管理員</option>
              </select>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-base">自動帳號啟用</Label>
                <p className="text-sm text-muted-foreground">
                  新註冊使用者自動啟用帳號
                </p>
              </div>
              <Switch />
            </div>
          </CardContent>
        </Card>

        {/* 庫存設定 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Database className="mr-2" size={20} />
              庫存設定
            </CardTitle>
            <CardDescription>
              設定庫存管理相關參數
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="global-threshold">全域庫存閾值 (KG)</Label>
              <Input
                id="global-threshold"
                type="number"
                placeholder="100"
                className="w-full"
              />
              <p className="text-sm text-muted-foreground">
                未設定個別閾值的產品將使用此預設值
              </p>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-base">自動採購建議</Label>
                <p className="text-sm text-muted-foreground">
                  庫存不足時自動產生採購建議
                </p>
              </div>
              <Switch />
            </div>
          </CardContent>
        </Card>

        {/* 郵件設定 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Mail className="mr-2" size={20} />
              郵件設定
            </CardTitle>
            <CardDescription>
              配置系統郵件發送設定
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="smtp-server">SMTP 伺服器</Label>
              <Input
                id="smtp-server"
                placeholder="smtp.gmail.com"
                className="w-full"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="smtp-port">連接埠</Label>
                <Input
                  id="smtp-port"
                  type="number"
                  placeholder="587"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="from-email">寄件者信箱</Label>
                <Input
                  id="from-email"
                  type="email"
                  placeholder="system@company.com"
                />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-base">啟用 SSL/TLS</Label>
                <p className="text-sm text-muted-foreground">
                  使用安全連線發送郵件
                </p>
              </div>
              <Switch defaultChecked />
            </div>
          </CardContent>
        </Card>

        {/* 公司資訊 */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center">
              <Users className="mr-2" size={20} />
              公司資訊
            </CardTitle>
            <CardDescription>
              更新公司基本資訊
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="company-name">公司名稱</Label>
                <Input
                  id="company-name"
                  placeholder="請輸入公司名稱"
                  defaultValue="紡織業股份有限公司"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="company-phone">公司電話</Label>
                <Input
                  id="company-phone"
                  placeholder="請輸入公司電話"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="company-address">公司地址</Label>
              <Input
                id="company-address"
                placeholder="請輸入完整地址"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="tax-id">統一編號</Label>
                <Input
                  id="tax-id"
                  placeholder="請輸入統一編號"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bank-account">銀行帳號</Label>
                <Input
                  id="bank-account"
                  placeholder="請輸入銀行帳號"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 保存設定按鈕 */}
      <div className="flex justify-end space-x-4">
        <Button variant="outline">
          重設為預設值
        </Button>
        <Button className="bg-blue-600 hover:bg-blue-700">
          保存設定
        </Button>
      </div>
    </div>
  );
};

export default SystemSettings;
