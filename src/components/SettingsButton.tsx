import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Tooltip, Modal, Tabs } from 'antd';
import { SettingOutlined, CloudSyncOutlined, MobileOutlined } from '@ant-design/icons';
import { GestureSettingsTab } from './gesture/GestureSettingsTab';
import { CloudStorageTab } from './cloud/CloudStorageTab';

interface SettingsButtonProps {
  onCloudSyncComplete?: () => void;
}

export const SettingsButton: React.FC<SettingsButtonProps> = ({ onCloudSyncComplete }) => {
  const { t } = useTranslation();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const handleCloudSyncComplete = () => {
    setSettingsOpen(false);
    onCloudSyncComplete?.();
  };

  return (
    <>
      <Tooltip title={t('settings.title')}>
        <Button
          type="text"
          icon={<SettingOutlined />}
          onClick={() => setSettingsOpen(true)}
        />
      </Tooltip>
      <Modal
        title={t('settings.title')}
        open={settingsOpen}
        onCancel={() => setSettingsOpen(false)}
        footer={null}
        width={700}
      >
        <Tabs
          items={[
            {
              key: 'gesture',
              label: (
                <span>
                  <MobileOutlined style={{ marginRight: 8 }} />
                  {t('gesture.title')}
                </span>
              ),
              children: <GestureSettingsTab />,
            },
            {
              key: 'cloud',
              label: (
                <span>
                  <CloudSyncOutlined style={{ marginRight: 8 }} />
                  {t('cloudStorage.title')}
                </span>
              ),
              children: <CloudStorageTab onSyncComplete={handleCloudSyncComplete} />,
            },
          ]}
        />
      </Modal>
    </>
  );
};

export default SettingsButton;
