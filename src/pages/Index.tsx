
import React, { useState } from 'react';
import Login from './Login';
import Dashboard from './Dashboard';

const Index = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  return (
    <div>
      {!isLoggedIn ? (
        <Login />
      ) : (
        <Dashboard />
      )}
    </div>
  );
};

export default Index;
