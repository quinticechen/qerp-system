import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ProtectedRoute } from './ProtectedRoute';

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));

function LoginProbe() {
  const location = useLocation();
  return <p>login:{location.search}</p>;
}

describe('ProtectedRoute', () => {
  it('sends signed-out visitors to sign in and back to where they were going', () => {
    render(
      <MemoryRouter initialEntries={['/checkout?plan=pro&period=year']}>
        <Routes>
          <Route path="/checkout" element={<ProtectedRoute><p>checkout</p></ProtectedRoute>} />
          <Route path="/login" element={<LoginProbe />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText(`login:?next=${encodeURIComponent('/checkout?plan=pro&period=year')}`)).toBeTruthy();
  });
});
