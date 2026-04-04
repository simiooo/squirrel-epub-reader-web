import React from 'react';
import { useTranslation } from 'react-i18next';
import { Switch, Slider, Typography, Space, Card, theme } from 'antd';
import { useGestureStore } from '../../stores/gestureStore';

const { Text } = Typography;

export const GestureSettingsTab: React.FC = () => {
  const { t } = useTranslation();
  const { token } = theme.useToken();

  const enabled = useGestureStore((state) => state.settings.enabled);
  const sensitivity = useGestureStore((state) => state.settings.sensitivity);
  const scrollSpeed = useGestureStore((state) => state.settings.scrollSpeed);
  const updateSettings = useGestureStore((state) => state.updateSettings);

  const scrollSpeedMarks = {
    1: '1',
    5: t('gesture.scrollSpeedMedium') || '中等',
    10: '10',
  };

  return (
    <Card size="small" style={{ marginTop: 16 }}>
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <Text>{t('gesture.enable')}</Text>
          <Switch
            checked={enabled}
            onChange={(checked) => updateSettings({ enabled: checked })}
          />
        </div>

        <div>
          <Text type="secondary" style={{ marginBottom: 8, display: 'block' }}>
            {t('gesture.sensitivity')}
          </Text>
          <Slider
            min={0.5}
            max={1.5}
            step={0.1}
            value={sensitivity}
            onChange={(value) => updateSettings({ sensitivity: value })}
            disabled={!enabled}
          />
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              color: token.colorTextTertiary,
              fontSize: 12,
            }}
          >
            <span>0.5</span>
            <span>{sensitivity.toFixed(1)}x</span>
            <span>1.5</span>
          </div>
        </div>

        <div>
          <Text type="secondary" style={{ marginBottom: 8, display: 'block' }}>
            {t('gesture.scrollSpeed')}
          </Text>
          <Slider
            min={1}
            max={10}
            marks={scrollSpeedMarks}
            value={scrollSpeed}
            onChange={(value) => updateSettings({ scrollSpeed: value })}
            disabled={!enabled}
          />
        </div>

        <div>
          <Text type="secondary" style={{ marginBottom: 8, display: 'block' }}>
            {t('gesture.instructions')}
          </Text>
          <Card size="small" style={{ background: token.colorFillTertiary }}>
            <Space direction="vertical" size="small">
              <Text>
                <span style={{ marginRight: 8 }}>🖐️</span>
                {t('gesture.openPalm')}
              </Text>
              <Text>
                <span style={{ marginRight: 8 }}>🤏</span>
                {t('gesture.pinch')}
              </Text>
              <Text>
                <span style={{ marginRight: 8 }}>✊</span>
                {t('gesture.fist')}
              </Text>
            </Space>
          </Card>
        </div>
      </Space>
    </Card>
  );
};

export default GestureSettingsTab;
