
import React from 'react';
import Layout from '@/components/Layout';
import OrderManagement from '@/components/OrderManagement';

const OrderPage = () => {
  return (
    <Layout>
      <div className="p-6">
        <OrderManagement />
      </div>
    </Layout>
  );
};

export default OrderPage;
