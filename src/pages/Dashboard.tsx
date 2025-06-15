
import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const Dashboard = () => {
  const quickActions = [
    { title: '新增訂單', description: '建立客戶新訂單', icon: '📋', color: 'from-blue-500 to-blue-600' },
    { title: '庫存管理', description: '查看和管理庫存', icon: '📦', color: 'from-green-500 to-green-600' },
    { title: '採購管理', description: '管理供應商採購', icon: '🛒', color: 'from-purple-500 to-purple-600' },
    { title: '出貨管理', description: '處理出貨作業', icon: '🚚', color: 'from-orange-500 to-orange-600' },
    { title: '客戶管理', description: '管理客戶資料', icon: '👥', color: 'from-pink-500 to-pink-600' },
    { title: '報表分析', description: '查看營運報表', icon: '📊', color: 'from-indigo-500 to-indigo-600' },
  ];

  const stats = [
    { title: '今日訂單', value: '12', trend: '+8%', color: 'text-blue-600' },
    { title: '待出貨', value: '23', trend: '-2%', color: 'text-orange-600' },
    { title: '庫存總重', value: '1,250 KG', trend: '+5%', color: 'text-green-600' },
    { title: '本月營收', value: 'NT$ 850,000', trend: '+12%', color: 'text-purple-600' },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-6">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* 標題區域 */}
        <div className="text-center space-y-4">
          <h1 className="text-4xl font-bold text-gray-800">ERP 管理中心</h1>
          <p className="text-gray-600">紡織業企業資源管理系統</p>
        </div>

        {/* 統計卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {stats.map((stat, index) => (
            <Card key={index} className="bg-white/70 backdrop-blur-sm border-0 shadow-lg hover:shadow-xl transition-all duration-300">
              <CardContent className="p-6">
                <div className="space-y-2">
                  <p className="text-sm text-gray-600">{stat.title}</p>
                  <div className="flex items-baseline justify-between">
                    <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
                    <span className={`text-sm ${stat.trend.startsWith('+') ? 'text-green-500' : 'text-red-500'}`}>
                      {stat.trend}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* 快速操作 */}
        <div className="space-y-6">
          <h2 className="text-2xl font-semibold text-gray-800 text-center">快速操作</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {quickActions.map((action, index) => (
              <Card key={index} className="group bg-white/70 backdrop-blur-sm border-0 shadow-lg hover:shadow-xl transition-all duration-300 cursor-pointer transform hover:scale-105">
                <CardHeader className="text-center">
                  <div className={`w-16 h-16 mx-auto mb-4 bg-gradient-to-r ${action.color} rounded-2xl flex items-center justify-center text-2xl shadow-lg group-hover:shadow-xl transition-shadow duration-300`}>
                    {action.icon}
                  </div>
                  <CardTitle className="text-lg">{action.title}</CardTitle>
                  <CardDescription>{action.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button className="w-full bg-gradient-to-r from-gray-600 to-gray-700 hover:from-gray-700 hover:to-gray-800 text-white">
                    進入功能
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* 系統狀態 */}
        <Card className="bg-white/70 backdrop-blur-sm border-0 shadow-lg">
          <CardHeader>
            <CardTitle className="text-xl">系統狀態</CardTitle>
            <CardDescription>各模組運行狀況</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex items-center space-x-3">
                <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                <span className="text-sm">訂單系統：正常運行</span>
              </div>
              <div className="flex items-center space-x-3">
                <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                <span className="text-sm">庫存系統：正常運行</span>
              </div>
              <div className="flex items-center space-x-3">
                <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                <span className="text-sm">報表系統：正常運行</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Dashboard;
