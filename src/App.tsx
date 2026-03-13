import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { ConfigProvider, theme } from 'antd';
import { useTranslation } from 'react-i18next';
import enUS from 'antd/locale/en_US';
import zhCN from 'antd/locale/zh_CN';
import { routes } from './routes';
import './App.css';
import './i18n';
import './styles/book-card.css';

const router = createBrowserRouter(routes);

const antdLocales: Record<string, typeof zhCN> = {
  en: enUS,
  zh: zhCN,
};

function App() {
  const { i18n } = useTranslation();
  const currentLang = i18n.language.startsWith('en') ? 'en' : 'zh';

  return (
    <ConfigProvider
      locale={antdLocales[currentLang]}
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
