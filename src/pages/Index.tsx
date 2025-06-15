
import React, { useState } from 'react';
import Login from './Login';
import Dashboard from './Dashboard';

const Index = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // 模擬登入狀態切換（實際項目中會由認證系統處理）
  React.useEffect(() => {
    const timer = setTimeout(() => {
      // 這裡可以檢查是否有有效的登入狀態
      // setIsLoggedIn(true); // 如果需要自動登入測試
    }, 100);

    return () => clearTimeout(timer);
  }, []);

  if (!isLoggedIn) {
    return <Login />;
  }

  return <Dashboard />;
};

export default Index;
