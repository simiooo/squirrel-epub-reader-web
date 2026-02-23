import React from 'react';
import { Button, Space } from 'antd';
import { useTranslation } from 'react-i18next';

export const LanguageSwitcher: React.FC = () => {
  const { i18n } = useTranslation();
  const currentLang = i18n.language.startsWith('en') ? 'en' : 'zh';

  const changeLanguage = (lang: string) => {
    i18n.changeLanguage(lang);
  };

  return (
    <Space>
      <Button
        type={currentLang === 'zh' ? 'primary' : 'default'}
        onClick={() => changeLanguage('zh')}
        size="small"
      >
        中文
      </Button>
      <Button
        type={currentLang === 'en' ? 'primary' : 'default'}
        onClick={() => changeLanguage('en')}
        size="small"
      >
        English
      </Button>
    </Space>
  );
};
