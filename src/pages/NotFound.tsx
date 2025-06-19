
import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import { SEO } from '@/components/SEO';

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error(
      "404 Error: User attempted to access non-existent route:",
      location.pathname
    );
  }, [location.pathname]);

  return (
    <>
      <SEO
        title="頁面不存在"
        description="抱歉，您要尋找的頁面不存在。請檢查網址或返回首頁繼續瀏覽我們的紡織業 ERP 系統。"
        keywords="404錯誤, 頁面不存在, 紡織業ERP"
      />
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center">
          <h1 className="text-6xl font-bold text-gray-800 mb-4">404</h1>
          <h2 className="text-2xl font-semibold text-gray-600 mb-4">頁面不存在</h2>
          <p className="text-xl text-gray-600 mb-8">抱歉，您要尋找的頁面無法找到</p>
          <a href="/" className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors">
            返回首頁
          </a>
        </div>
      </div>
    </>
  );
};

export default NotFound;
