import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { ConfigProvider, theme } from 'antd';
import { routes } from './routes';
import './App.css';

const router = createBrowserRouter(routes);

function App() {
  return (
    <ConfigProvider
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: '#1890ff',
          borderRadius: 6,
        },
      }}
    >
      <RouterProvider router={router} />
    </ConfigProvider>
  );
}

export default App;
