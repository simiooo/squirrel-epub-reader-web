import React, { useState } from 'react';
import { Button, Tooltip } from 'antd';
import { SettingOutlined } from '@ant-design/icons';
import { GestureSettings } from './gesture/GestureSettings';

export const SettingsButton: React.FC = () => {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <>
      <Tooltip title="设置">
        <Button
          type="text"
          icon={<SettingOutlined />}
          onClick={() => setSettingsOpen(true)}
        />
      </Tooltip>
      <GestureSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
};
