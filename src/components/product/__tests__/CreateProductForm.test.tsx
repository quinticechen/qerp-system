
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CreateProductDialog } from '../CreateProductDialog';
import { supabase } from '@/integrations/supabase/client';

// Mock Supabase
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      insert: vi.fn(() => ({
        data: [],
        error: null
      })),
      select: vi.fn(() => ({
        data: [],
        error: null
      }))
    })),
    auth: {
      getUser: vi.fn(() => ({ data: { user: { id: 'test-user' } } }))
    }
  }
}));

const createQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false }
  }
});

const renderWithQueryClient = (component: React.ReactElement) => {
  const queryClient = createQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      {component}
    </QueryClientProvider>
  );
};

describe('CreateProductDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('應該允許用戶為產品設定庫存閾值', async () => {
    renderWithQueryClient(
      <CreateProductDialog open={true} onOpenChange={() => {}} />
    );
    
    // 填入產品基本資訊
    const nameInput = screen.getByPlaceholderText('輸入產品名稱');
    fireEvent.change(nameInput, { target: { value: '測試布料' } });
    
    const colorInput = screen.getByPlaceholderText('輸入顏色');
    fireEvent.change(colorInput, { target: { value: '紅色' } });
    
    // 設定庫存閾值
    const thresholdInput = screen.getByPlaceholderText('輸入庫存閾值 (kg)');
    expect(thresholdInput).toBeInTheDocument();
    
    fireEvent.change(thresholdInput, { target: { value: '100' } });
    
    // 提交表單
    const submitButton = screen.getByText('新增產品');
    fireEvent.click(submitButton);
    
    await waitFor(() => {
      expect(supabase.from).toHaveBeenCalledWith('products_new');
    });
  });

  it('應該驗證庫存閾值必須是正數', async () => {
    renderWithQueryClient(
      <CreateProductDialog open={true} onOpenChange={() => {}} />
    );
    
    const thresholdInput = screen.getByPlaceholderText('輸入庫存閾值 (kg)');
    fireEvent.change(thresholdInput, { target: { value: '-10' } });
    
    const submitButton = screen.getByText('新增產品');
    fireEvent.click(submitButton);
    
    await waitFor(() => {
      expect(screen.getByText('庫存閾值必須大於 0')).toBeInTheDocument();
    });
  });

  it('應該允許不設定庫存閾值', async () => {
    renderWithQueryClient(
      <CreateProductDialog open={true} onOpenChange={() => {}} />
    );
    
    // 只填入必要資訊，不設定閾值
    const nameInput = screen.getByPlaceholderText('輸入產品名稱');
    fireEvent.change(nameInput, { target: { value: '測試布料' } });
    
    const submitButton = screen.getByText('新增產品');
    fireEvent.click(submitButton);
    
    await waitFor(() => {
      expect(supabase.from).toHaveBeenCalledWith('products_new');
    });
  });
});
