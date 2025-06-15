
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import ProductPage from "./pages/ProductPage";
import OrderPage from "./pages/OrderPage";
import PurchasePage from "./pages/PurchasePage";
import InventoryPage from "./pages/InventoryPage";
import FactoryPage from "./pages/FactoryPage";
import CustomerPage from "./pages/CustomerPage";
import SystemPage from "./pages/SystemPage";
import UserPage from "./pages/UserPage";
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
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/product" element={<ProductPage />} />
          <Route path="/order" element={<OrderPage />} />
          <Route path="/purchase" element={<PurchasePage />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/factory" element={<FactoryPage />} />
          <Route path="/customer" element={<CustomerPage />} />
          <Route path="/system" element={<SystemPage />} />
          <Route path="/user" element={<UserPage />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
