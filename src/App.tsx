
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ProtectedRoute } from "./components/ProtectedRoute";
import Index from "./pages/Index";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import ProductPage from "./pages/ProductPage";
import OrderPage from "./pages/OrderPage";
import PurchasePage from "./pages/PurchasePage";
import InventoryPage from "./pages/InventoryPage";
import ShippingPage from "./pages/ShippingPage";
import FactoryPage from "./pages/FactoryPage";
import CustomerPage from "./pages/CustomerPage";
import SystemPage from "./pages/SystemPage";
import UserPage from "./pages/UserPage";
import PermissionPage from "./pages/PermissionPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/login" element={<Login />} />
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/product" element={<ProtectedRoute><ProductPage /></ProtectedRoute>} />
          <Route path="/order" element={<ProtectedRoute><OrderPage /></ProtectedRoute>} />
          <Route path="/purchase" element={<ProtectedRoute><PurchasePage /></ProtectedRoute>} />
          <Route path="/inventory" element={<ProtectedRoute><InventoryPage /></ProtectedRoute>} />
          <Route path="/shipping" element={<ProtectedRoute><ShippingPage /></ProtectedRoute>} />
          <Route path="/factory" element={<ProtectedRoute><FactoryPage /></ProtectedRoute>} />
          <Route path="/customer" element={<ProtectedRoute><CustomerPage /></ProtectedRoute>} />
          <Route path="/system" element={<ProtectedRoute><SystemPage /></ProtectedRoute>} />
          <Route path="/user" element={<ProtectedRoute><UserPage /></ProtectedRoute>} />
          <Route path="/permission" element={<ProtectedRoute><PermissionPage /></ProtectedRoute>} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
