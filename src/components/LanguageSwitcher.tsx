import React from 'react';
import { Select } from 'antd';
import { useTranslation } from 'react-i18next';
import { GlobalOutlined } from '@ant-design/icons';

const { Option } = Select;

const languages = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
  { value: 'ko', label: '한국어' },
  { value: 'ja', label: '日本語' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
];

const getCurrentLang = (lang: string): string => {
  const langCode = lang.split('-')[0];
  const supportedLangs = ['zh', 'en', 'ko', 'ja', 'es', 'fr'];
  return supportedLangs.includes(langCode) ? langCode : 'zh';
};

export const LanguageSwitcher: React.FC = () => {
  const { i18n } = useTranslation();
  const currentLang = getCurrentLang(i18n.language);

  const changeLanguage = (lang: string) => {
    i18n.changeLanguage(lang);
  };

  return (
    <Select
      value={currentLang}
      onChange={changeLanguage}
      style={{ width: 120 }}
      bordered={false}
      suffixIcon={<GlobalOutlined />}
    >
      {languages.map((lang) => (
        <Option key={lang.value} value={lang.value}>
          {lang.label}
        </Option>
      ))}
    </Select>
  );
};

export default LanguageSwitcher;
