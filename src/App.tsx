import { ConfigProvider, App as AntdApp } from 'antd';
import { useTranslation } from 'react-i18next';
import enUS from 'antd/locale/en_US';
import zhCN from 'antd/locale/zh_CN';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { Analytics } from '@vercel/analytics/react';
import { routes } from './routes';
import './App.css';
import './i18n';
import './styles/book-card.css';

const router = createBrowserRouter(routes);

const antdLocales: Record<string, typeof zhCN> = {
  en: enUS,
  zh: zhCN,
};

const squirrelTheme = {
  token: {
    colorPrimary: '#D4884A',
    colorSuccess: '#6B8E6B',
    colorWarning: '#C9A96E',
    colorError: '#C25D5D',
    colorInfo: '#8B9A8B',
    colorBgBase: '#FAF7F2',
    colorTextBase: '#3E2723',
    borderRadius: 8,
    borderRadiusLG: 12,
    borderRadiusSM: 4,
    fontFamily: '"MiSans", "Nunito", system-ui, -apple-system, sans-serif',
    fontSize: 15,
    fontSizeLG: 16,
    fontSizeSM: 13,
    lineHeight: 1.6,
    lineHeightLG: 1.5,
    lineHeightSM: 1.67,
    colorBorder: '#E0D6C8',
    colorBorderSecondary: '#EDE7DD',
    colorBgContainer: '#FFFFFF',
    colorBgElevated: '#FFFFFF',
    colorBgLayout: '#FAF7F2',
    colorBgSpotlight: '#F5EFE6',
    colorText: '#3E2723',
    colorTextSecondary: '#6D5D4D',
    colorTextTertiary: '#8D7D6D',
    colorTextQuaternary: '#AD9D8D',
    boxShadow: '0 2px 8px rgba(62, 39, 35, 0.08)',
    boxShadowSecondary: '0 4px 16px rgba(62, 39, 35, 0.12)',
  },
  components: {
    Button: {
      colorPrimary: '#D4884A',
      colorPrimaryHover: '#C07A3E',
      colorPrimaryActive: '#A86830',
      colorBgContainer: '#FFFFFF',
      colorBorder: '#D4C4B0',
      borderRadius: 8,
      paddingBlock: 8,
      paddingInline: 20,
      controlHeight: 42,
      fontWeight: 500,
    },
    Card: {
      colorBgContainer: '#FFFFFF',
      borderRadiusLG: 12,
      paddingLG: 24,
      boxShadow: '0 2px 12px rgba(62, 39, 35, 0.06)',
    },
    Input: {
      colorBgContainer: '#FFFFFF',
      colorBorder: '#D4C4B0',
      borderRadius: 8,
      controlHeight: 42,
      paddingBlock: 8,
      paddingInline: 14,
      activeShadow: '0 0 0 2px rgba(212, 136, 74, 0.15)',
      hoverShadow: '0 0 0 1px #D4884A',
    },
    Select: {
      colorBgContainer: '#FFFFFF',
      colorBorder: '#D4C4B0',
      borderRadius: 8,
      controlHeight: 42,
      optionSelectedBg: '#F5EFE6',
    },
    Menu: {
      colorBgContainer: '#FAF7F2',
      colorBgElevated: '#FFFFFF',
      itemBg: '#FAF7F2',
      itemSelectedBg: '#F5EFE6',
      itemSelectedColor: '#D4884A',
      itemHoverBg: '#F0EAE0',
      itemActiveBg: '#E8DFD0',
      itemBorderRadius: 8,
      itemMarginInline: 8,
    },
    Layout: {
      colorBgBody: '#FAF7F2',
      colorBgContainer: '#FFFFFF',
      colorBgElevated: '#FFFFFF',
      headerBg: '#FFFFFF',
      siderBg: '#FAF7F2',
      footerBg: '#FAF7F2',
    },
    Modal: {
      contentBg: '#FFFFFF',
      headerBg: '#FFFFFF',
      borderRadiusLG: 16,
      paddingLG: 28,
    },
    Drawer: {
      colorBgElevated: '#FFFFFF',
      borderRadiusLG: 16,
    },
    Dropdown: {
      colorBgElevated: '#FFFFFF',
      borderRadiusLG: 10,
      paddingBlock: 8,
      paddingInline: 4,
    },
    Tooltip: {
      colorBgSpotlight: '#3E2723',
      borderRadius: 6,
      paddingBlock: 8,
      paddingInline: 12,
    },
    Message: {
      contentBg: '#FFFFFF',
      borderRadiusLG: 10,
    },
    Notification: {
      colorBgElevated: '#FFFFFF',
      borderRadiusLG: 12,
      paddingLG: 20,
    },
    Slider: {
      trackBg: '#E0D6C8',
      trackHoverBg: '#D4C4B0',
      railBg: '#F0EAE0',
      railHoverBg: '#E8DFD0',
      handleColor: '#D4884A',
      handleActiveColor: '#C07A3E',
      dotActiveBorderColor: '#D4884A',
    },
    Switch: {
      colorPrimary: '#D4884A',
      colorPrimaryHover: '#C07A3E',
      handleSize: 20,
    },
    Checkbox: {
      colorPrimary: '#D4884A',
      colorPrimaryHover: '#C07A3E',
      borderRadiusSM: 4,
    },
    Radio: {
      colorPrimary: '#D4884A',
      colorPrimaryHover: '#C07A3E',
    },
    Tabs: {
      inkBarColor: '#D4884A',
      itemSelectedColor: '#D4884A',
      itemHoverColor: '#C07A3E',
      itemActiveColor: '#A86830',
      horizontalItemGutter: 24,
      horizontalItemPadding: '12px 0',
    },
    Tag: {
      borderRadiusSM: 4,
      defaultBg: '#F5EFE6',
      defaultColor: '#6D5D4D',
    },
    Badge: {
      colorBgContainer: '#FFFFFF',
    },
    Progress: {
      defaultColor: '#D4884A',
      remainingColor: '#F0EAE0',
    },
    Steps: {
      colorPrimary: '#D4884A',
      colorTextDescription: '#8D7D6D',
    },
    Timeline: {
      colorText: '#6D5D4D',
    },
    Divider: {
      colorSplit: '#E0D6C8',
    },
    Table: {
      headerBg: '#FAF7F2',
      headerColor: '#3E2723',
      headerSortActiveBg: '#F0EAE0',
      headerSortHoverBg: '#F5EFE6',
      rowHoverBg: '#FAF7F2',
      borderColor: '#E0D6C8',
    },
    Tree: {
      colorBgContainer: '#FFFFFF',
      nodeSelectedBg: '#F5EFE6',
      nodeHoverBg: '#F0EAE0',
    },
    Pagination: {
      itemBg: '#FFFFFF',
      itemActiveBg: '#F5EFE6',
      itemSelectedBg: '#F5EFE6',
    },
    Breadcrumb: {
      itemColor: '#8D7D6D',
      lastItemColor: '#3E2723',
      linkHoverColor: '#D4884A',
      separatorColor: '#D4C4B0',
    },
    FloatButton: {
      colorBgElevated: '#FFFFFF',
      colorPrimary: '#D4884A',
      colorPrimaryHover: '#C07A3E',
    },
  },
};

export function App() {
  const { i18n } = useTranslation();
  const currentLang = i18n.language.startsWith('en') ? 'en' : 'zh';

  return (
    <ConfigProvider locale={antdLocales[currentLang]} theme={squirrelTheme}>
      <AntdApp>
        <RouterProvider router={router} />
        <Analytics />
      </AntdApp>
    </ConfigProvider>
  );
}

export default App;
