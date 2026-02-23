import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookList } from '../components/BookList';
import { BookImport } from '../components/BookImport';
import { LanguageSwitcher } from '../components/LanguageSwitcher';

export const HomePage: React.FC = () => {
  const { t } = useTranslation();
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleImport = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f5f5f5', padding: 24 }}>
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>{t('nav.myBookshelf')}</h2>
        <div style={{ display: 'flex', gap: 12 }}>
          <LanguageSwitcher />
          <BookImport onImport={handleImport} />
        </div>
      </div>
      <BookList refreshTrigger={refreshTrigger} />
    </div>
  );
};
