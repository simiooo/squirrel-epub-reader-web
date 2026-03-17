import React from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Tooltip } from 'antd';
import { MobileOutlined } from '@ant-design/icons';
import { useGestureStore } from '../../stores/gestureStore';

interface GestureIndicatorProps {
  onClick?: () => void;
}

export const GestureIndicator: React.FC<GestureIndicatorProps> = ({ onClick }) => {
  const { t } = useTranslation();
  
  const enabled = useGestureStore((state) => state.settings.enabled);
  const gestureState = useGestureStore((state) => state.runtime.state);
  const isInitializing = useGestureStore((state) => state.runtime.isInitializing);
  const error = useGestureStore((state) => state.runtime.error);
  const toggleEnabled = useGestureStore((state) => state.toggleEnabled);

  const handleClick = () => {
    if (onClick) {
      onClick();
    } else {
      toggleEnabled();
    }
  };

  const getStatusColor = () => {
    if (!enabled) return 'default';
    if (isInitializing) return 'processing';
    if (error) return 'error';
    switch (gestureState) {
      case 'tracking':
        return 'processing';
      case 'pinch':
        return 'success';
      case 'scroll':
        return 'warning';
      default:
        return 'default';
    }
  };

  const getStatusText = () => {
    if (!enabled) return t('gesture.off') || '手势关闭';
    if (isInitializing) return t('gesture.initializing') || '初始化中...';
    if (error) return t('gesture.error') || '错误';
    switch (gestureState) {
      case 'tracking':
        return '🖐️';
      case 'pinch':
        return '🤏';
      case 'scroll':
        return '✌️';
      default:
        return t('gesture.off') || '手势关闭';
    }
  };

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
          border: enabled ? '1px solid #1890ff' : '1px solid transparent',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.06)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.02)';
        }}
      >
        <Badge status={getStatusColor()} />
        <MobileOutlined style={{ color: enabled ? '#1890ff' : 'var(--antd-color-text-secondary)' }} />
        <span style={{ fontSize: 12, color: enabled ? '#1890ff' : 'var(--antd-color-text-secondary)' }}>
          {getStatusText()}
        </span>
      </div>
    </Tooltip>
  );
};
