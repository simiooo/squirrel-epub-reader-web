import React from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Tooltip } from 'antd';
import { MobileOutlined } from '@ant-design/icons';
import { useGestureSettings, useGestureRuntime } from '../../contexts/useGestureHooks';

interface GestureIndicatorProps {
  onClick?: () => void;
}

export const GestureIndicator: React.FC<GestureIndicatorProps> = ({ onClick }) => {
  const { t } = useTranslation();
  const { settings, updateSettings } = useGestureSettings();
  const { runtimeState } = useGestureRuntime();
  const state = runtimeState.state;

  const handleClick = () => {
    if (onClick) {
      onClick();
    } else {
      updateSettings({ enabled: !settings.enabled });
    }
  };

  const statusColor = !settings.enabled ? 'default' : state === 'idle' ? 'default' : state === 'tracking' ? 'processing' : state === 'pinch' ? 'success' : 'warning';
  const statusText = !settings.enabled ? t('gesture.off') : state === 'idle' ? t('gesture.off') : state === 'tracking' ? '🖐️' : state === 'pinch' ? '🤏' : '✊';

  return (
    <Tooltip title={`${t('gesture.title')} - ${t('gesture.clickToToggle')}`}>
      <div
        onClick={handleClick}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 8px',
          borderRadius: 4,
          backgroundColor: 'rgba(0, 0, 0, 0.02)',
          cursor: 'pointer',
          transition: 'background-color 0.2s',
          border: settings.enabled ? '1px solid #1890ff' : '1px solid transparent',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.06)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.02)';
        }}
      >
        <Badge status={statusColor} />
        <MobileOutlined style={{ color: settings.enabled ? '#1890ff' : 'var(--antd-color-text-secondary)' }} />
        <span style={{ fontSize: 12, color: settings.enabled ? '#1890ff' : 'var(--antd-color-text-secondary)' }}>
          {statusText}
        </span>
      </div>
    </Tooltip>
  );
};
