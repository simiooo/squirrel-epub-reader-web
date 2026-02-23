import type { RouteObject } from 'react-router-dom';
import { HomePage } from '../pages/HomePage';
import { ReadPage } from '../pages/ReadPage';

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <HomePage />,
  },
  {
    path: '/read/:bookId',
    element: <ReadPage />,
  },
];
