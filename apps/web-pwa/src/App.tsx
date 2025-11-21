import React from 'react';
import { Outlet } from '@tanstack/react-router';

export const AppLayout: React.FC = () => {
  return <Outlet />;
};

export default AppLayout;
