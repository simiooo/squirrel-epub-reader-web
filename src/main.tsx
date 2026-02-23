import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { message, Modal } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import './index.css';
import App from './App.tsx';

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
              title: '发现新版本',
              icon: <ReloadOutlined />,
              content: '应用有新版本可用，是否立即更新？',
              okText: '立即更新',
              cancelText: '稍后',
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
      message.success('应用已更新到最新版本');
    }
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
