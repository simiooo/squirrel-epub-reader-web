import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookList } from '../components/BookList';
import { BookImport } from '../components/BookImport';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { CloudStoragePanel } from '../components/CloudStoragePanel';
import { SettingsButton } from '../components/SettingsButton';
import { GestureOverlay } from '../components/gesture/GestureOverlay';

export const HomePage: React.FC = () => {
  const { t } = useTranslation();
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleImport = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  const handleSyncComplete = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  return (
    <div 
      data-gesture-scrollable
      style={{ minHeight: '100vh', backgroundColor: '#f5f5f5', padding: 24, overflow: 'auto' }}
    >
      <GestureOverlay />
      <div style={{ 
        marginBottom: 24, 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 12,
      }}>
        <h2 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>{t('nav.myBookshelf')}</h2>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <CloudStoragePanel onSyncComplete={handleSyncComplete} />
          <LanguageSwitcher />
          <SettingsButton />
          <BookImport onImport={handleImport} />
        </div>
      </div>
      <BookList refreshTrigger={refreshTrigger} />
    </div>
  );
};

export default HomePage;
