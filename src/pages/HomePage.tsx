import { useState } from 'react';
import { BookList } from '../components/BookList';
import { BookImport } from '../components/BookImport';

export const HomePage: React.FC = () => {
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleImport = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f5f5f5', padding: 24 }}>
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>我的书架</h2>
        <BookImport onImport={handleImport} />
      </div>
      <BookList refreshTrigger={refreshTrigger} />
    </div>
  );
};
