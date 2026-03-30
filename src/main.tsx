import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { message, Modal } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import './index.css';
import App from './App.tsx';
import { fixCloudBookCacheStatus, migrateBookChecksums } from './db/index.ts';

// Register service worker and handle updates
if ('serviceWorker' in navigator) {
  // Wait for the service worker to be ready
  navigator.serviceWorker.ready.then((registration) => {
    // Check for updates periodically
    setInterval(() => {
      registration.update();
    }, 60 * 60 * 1000); // Check every hour

    // Listen for new service worker installation
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      
      if (newWorker) {
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // New content is available, show update prompt
            Modal.confirm({
              title: 'New Version Available',
              icon: <ReloadOutlined />,
              content: 'A new version of the application is available. Would you like to update now?',
              okText: 'Update Now',
              cancelText: 'Later',
              onOk() {
                newWorker.postMessage({ type: 'SKIP_WAITING' });
                window.location.reload();
              },
            });
          }
        });
      }
    });
  });

  // Handle messages from service worker
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SW_UPDATE') {
      message.success('Application updated successfully');
    }
  });
}

// 启动时执行数据修复
Promise.all([
  fixCloudBookCacheStatus(),
  migrateBookChecksums(),
]).catch(console.error);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
