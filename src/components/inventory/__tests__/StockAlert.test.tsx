
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StockAlertManager } from '../StockAlertManager';
import { supabase } from '@/integrations/supabase/client';

// Mock Supabase
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        data: [],
        error: null
      })),
      insert: vi.fn(() => ({
        data: [],
        error: null
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          data: [],
          error: null
        }))
      })),
      delete: vi.fn(() => ({
        eq: vi.fn(() => ({
          data: [],
          error: null
        }))
      }))
    }))
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

describe('StockAlertManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('應該渲染庫存預警管理界面', () => {
    renderWithQueryClient(<StockAlertManager />);
    expect(screen.getByText('庫存預警設定')).toBeInTheDocument();
  });

  it('應該允許為產品設定庫存閾值', async () => {
    const mockProducts = [
      { id: '1', name: '測試布料', color: '紅色' }
    ];

    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnValue({
        data: mockProducts,
        error: null
      }),
      insert: vi.fn().mockReturnValue({
        data: [{ id: '1', product_id: '1', threshold_quantity: 100 }],
        error: null
      })
    } as any);

    renderWithQueryClient(<StockAlertManager />);
    
    // 選擇產品
    const productSelect = screen.getByPlaceholderText('選擇產品');
    fireEvent.click(productSelect);
    
    // 輸入閾值
    const thresholdInput = screen.getByPlaceholderText('輸入庫存閾值');
    fireEvent.change(thresholdInput, { target: { value: '100' } });
    
    // 提交
    const submitButton = screen.getByText('設定閾值');
    fireEvent.click(submitButton);
    
    await waitFor(() => {
      expect(supabase.from).toHaveBeenCalledWith('stock_thresholds');
    });
  });

  it('應該驗證閾值必須大於0', async () => {
    renderWithQueryClient(<StockAlertManager />);
    
    const thresholdInput = screen.getByPlaceholderText('輸入庫存閾值');
    fireEvent.change(thresholdInput, { target: { value: '-10' } });
    
    const submitButton = screen.getByText('設定閾值');
    fireEvent.click(submitButton);
    
    await waitFor(() => {
      expect(screen.getByText('閾值必須大於 0')).toBeInTheDocument();
    });
  });
});

describe('StockAlertNotification', () => {
  it('應該顯示低庫存警告', () => {
    const mockLowStockProducts = [
      {
        product_id: '1',
        product_name: '測試布料',
        color: '紅色',
        current_stock: 50,
        threshold: 100
      }
    ];

    renderWithQueryClient(
      <StockAlertNotification lowStockProducts={mockLowStockProducts} />
    );
    
    expect(screen.getByText('庫存不足警告')).toBeInTheDocument();
    expect(screen.getByText('測試布料 (紅色)')).toBeInTheDocument();
    expect(screen.getByText('當前庫存: 50.00 kg')).toBeInTheDocument();
    expect(screen.getByText('預警閾值: 100.00 kg')).toBeInTheDocument();
  });

  it('當沒有低庫存產品時不應該顯示警告', () => {
    renderWithQueryClient(<StockAlertNotification lowStockProducts={[]} />);
    expect(screen.queryByText('庫存不足警告')).not.toBeInTheDocument();
  });
});
