import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/sonner';
import Login from '@/pages/Login';
import Index from '@/pages/Index';
import Dashboard from '@/pages/Dashboard';
import ProductPage from '@/pages/ProductPage';
import CustomerPage from '@/pages/CustomerPage';
import FactoryPage from '@/pages/FactoryPage';
import OrderPage from '@/pages/OrderPage';
import PurchasePage from '@/pages/PurchasePage';
import InventoryPage from '@/pages/InventoryPage';
import ShippingPage from '@/pages/ShippingPage';
import UserPage from '@/pages/UserPage';
import PermissionPage from '@/pages/PermissionPage';
import OrganizationRolePage from '@/pages/OrganizationRolePage';
import SystemPage from '@/pages/SystemPage';
import CreateOrganization from '@/pages/CreateOrganization';
import NotFound from '@/pages/NotFound';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { OrganizationProvider } from '@/contexts/OrganizationContext';
import { OrganizationGuard } from '@/components/organization/OrganizationGuard';
import './App.css';

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <OrganizationProvider>
          <Routes>
            {/* 公開路由 */}
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<Index />} />
            
            {/* 受保護路由 - 需要登入但不需要組織 */}
            <Route
              path="/create-organization"
              element={
                <ProtectedRoute>
                  <CreateOrganization />
                </ProtectedRoute>
              }
            />
            
            {/* 受保護路由 - 需要登入且需要組織 */}
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <OrganizationGuard>
                    <Dashboard />
                  </OrganizationGuard>
                </ProtectedRoute>
              }
            />
            <Route
              path="/products"
              element={
                <ProtectedRoute>
                  <OrganizationGuard>
                    <ProductPage />
                  </OrganizationGuard>
                </ProtectedRoute>
              }
            />
            <Route
              path="/customers"
              element={
                <ProtectedRoute>
                  <OrganizationGuard>
                    <CustomerPage />
                  </OrganizationGuard>
                </ProtectedRoute>
              }
            />
            <Route
              path="/factories"
              element={
                <ProtectedRoute>
                  <OrganizationGuard>
                    <FactoryPage />
                  </OrganizationGuard>
                </ProtectedRoute>
              }
            />
            <Route
              path="/orders"
              element={
                <ProtectedRoute>
                  <OrganizationGuard>
                    <OrderPage />
                  </OrganizationGuard>
                </ProtectedRoute>
              }
            />
            <Route
              path="/purchases"
              element={
                <ProtectedRoute>
                  <OrganizationGuard>
                    <PurchasePage />
                  </OrganizationGuard>
                </ProtectedRoute>
              }
            />
            <Route
              path="/inventory"
              element={
                <ProtectedRoute>
                  <OrganizationGuard>
                    <InventoryPage />
                  </OrganizationGuard>
                </ProtectedRoute>
              }
            />
            <Route
              path="/shipping"
              element={
                <ProtectedRoute>
                  <OrganizationGuard>
                    <ShippingPage />
                  </OrganizationGuard>
                </ProtectedRoute>
              }
            />
            <Route
              path="/users"
              element={
                <ProtectedRoute>
                  <OrganizationGuard>
                    <UserPage />
                  </OrganizationGuard>
                </ProtectedRoute>
              }
            />
            <Route
              path="/permissions"
              element={
                <ProtectedRoute>
                  <OrganizationGuard>
                    <PermissionPage />
                  </OrganizationGuard>
                </ProtectedRoute>
              }
            />
            <Route
              path="/organization-roles"
              element={
                <ProtectedRoute>
                  <OrganizationGuard>
                    <OrganizationRolePage />
                  </OrganizationGuard>
                </ProtectedRoute>
              }
            />
            <Route
              path="/system"
              element={
                <ProtectedRoute>
                  <OrganizationGuard>
                    <SystemPage />
                  </OrganizationGuard>
                </ProtectedRoute>
              }
            />
            
            {/* 錯誤處理路由 */}
            <Route path="/404" element={<NotFound />} />
            <Route path="*" element={<Navigate to="/404" replace />} />
          </Routes>
          <Toaster />
        </OrganizationProvider>
      </Router>
    </QueryClientProvider>
  );
}

export default App;
