import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Form, Input, Switch, InputNumber, Button, Space, message, Divider, Alert, Steps, Select, theme } from 'antd';
import { CheckCircleOutlined, LoadingOutlined, LoginOutlined, DisconnectOutlined } from '@ant-design/icons';
import type { StoredConnector } from '../../types';
import type { ConnectorTypeInfo } from '../../types/cloudStorage';
import { GoogleDriveConnector } from '../../services/connectors/googleDriveConnector';
import { DropboxConnector } from '../../services/connectors/dropboxConnector';
import { S3Connector } from '../../services/connectors/s3Connector';

interface ConnectorConfigFormProps {
  visible: boolean;
  connectorType: string;
  connectorTypeInfo?: ConnectorTypeInfo;
  editingConnector?: StoredConnector | null;
  onSubmit: (connector: Omit<StoredConnector, 'id' | 'createdAt'>) => Promise<void>;
  onCancel: () => void;
}

interface FormValues {
  name: string;
  [key: string]: string | number | boolean | undefined;
}

type AuthStatus = 'unauthenticated' | 'authenticating' | 'authenticated' | 'expired' | 'error';

export const ConnectorConfigForm: React.FC<ConnectorConfigFormProps> = ({
  visible,
  connectorType,
  connectorTypeInfo,
  editingConnector,
  onSubmit,
  onCancel,
}) => {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const [form] = Form.useForm<FormValues>();
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message?: string } | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [authStatus, setAuthStatus] = useState<AuthStatus>('unauthenticated');
  const [savedSettings, setSavedSettings] = useState<Record<string, unknown> | null>(null);
  const [tempConnectorId, setTempConnectorId] = useState<string | null>(null);

  const requiresOAuth = connectorTypeInfo?.authMethods.includes('oauth2');

  useEffect(() => {
    if (visible) {
      if (editingConnector) {
        form.setFieldsValue({
          name: editingConnector.name,
          authStatus: editingConnector.authStatus,
          ...editingConnector.settings,
        });
        setAuthStatus((editingConnector.authStatus as AuthStatus) || 'unauthenticated');
        setSavedSettings(editingConnector.settings);
        setTempConnectorId(editingConnector.id);
        setCurrentStep(editingConnector.authStatus === 'authenticated' ? 1 : 0);
      } else {
        form.resetFields();
        setAuthStatus('unauthenticated');
        setSavedSettings(null);
        setTempConnectorId(null);
        setCurrentStep(0);
        if (connectorTypeInfo) {
          const defaultValues: Record<string, unknown> = {};
          connectorTypeInfo.requiredSettings.forEach(field => {
            if (field.defaultValue !== undefined) {
              defaultValues[field.key] = field.defaultValue;
            }
          });
          connectorTypeInfo.optionalSettings.forEach(field => {
            if (field.defaultValue !== undefined) {
              defaultValues[field.key] = field.defaultValue;
            }
          });
          form.setFieldsValue(defaultValues as unknown as FormValues);
        }
      }
      setTestResult(null);
    }
  }, [visible, editingConnector, connectorTypeInfo, form]);

  // 处理OAuth回调
  useEffect(() => {
    const handleOAuthCallback = async (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_CALLBACK') {
        const { code, state, error } = event.data;
        
        if (error) {
          setAuthStatus('error');
          message.error(t('cloudStorage.config.authFailed', { error }));
          return;
        }

        if (code && tempConnectorId) {
          setAuthStatus('authenticating');
          try {
            const connector = await getConnectorInstance(connectorType, tempConnectorId, savedSettings || {});
            if (connector && 'handleAuthCallback' in connector) {
              const success = await connector.handleAuthCallback({ code, state });
              if (success) {
                setAuthStatus('authenticated');
                message.success(t('cloudStorage.authenticated'));
                setCurrentStep(1);
              } else {
                setAuthStatus('error');
                message.error(t('cloudStorage.error'));
              }
            }
          } catch (err) {
            setAuthStatus('error');
            message.error(`${err}`);
          }
        }
      }
    };

    window.addEventListener('message', handleOAuthCallback);
    return () => window.removeEventListener('message', handleOAuthCallback);
  }, [connectorType, tempConnectorId, savedSettings, t]);

  const getConnectorInstance = useCallback((type: string, id: string, settings: Record<string, unknown>) => {
    const config = {
      id,
      name: form.getFieldValue('name') || type,
      type,
      settings,
      createdAt: new Date(),
    };

    switch (type) {
      case 's3':
        return new S3Connector(config);
      case 'dropbox':
        return new DropboxConnector(config);
      case 'googledrive':
        return new GoogleDriveConnector(config);
      default:
        return null;
    }
  }, [form]);

  const handleTestConnection = async () => {
    try {
      await form.validateFields();
    } catch {
      return;
    }

    setTesting(true);
    setTestResult(null);

    try {
      const values = form.getFieldsValue();
      const settings: Record<string, unknown> = {};
      Object.keys(values).forEach(key => {
        if (key !== 'name') {
          settings[key] = values[key];
        }
      });

      const connector = getConnectorInstance(connectorType, 'temp', settings);
      if (connector && 'testConnection' in connector) {
        const result = await connector.testConnection();
        setTestResult(result);
        console.log('Test connection result:', result);
        if (result.success) {
          // 对于非OAuth认证方式（如S3），测试连接成功即视为已认证
          if (!requiresOAuth) {
            console.log('Test successful, setting authStatus to authenticated');
            // 更新表单字段，然后自动提交
            form.setFieldsValue({ authStatus: 'authenticated' });
            setAuthStatus('authenticated');
            setCurrentStep(1);
            // 自动触发表单提交
            form.submit();
          } else {
            message.success(t('cloudStorage.config.connectionSuccess'));
          }
        } else {
          message.error(t('cloudStorage.config.connectionFailed', { error: result.message }));
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setTestResult({ success: false, message: errorMessage });
      message.error(t('cloudStorage.config.connectionFailed', { error: errorMessage }));
    } finally {
      setTesting(false);
    }
  };

  const handleAuthenticate = async () => {
    try {
      await form.validateFields();
    } catch {
      return;
    }

    const values = form.getFieldsValue();
      const settings: Record<string, unknown> = {};
      Object.keys(values).forEach(key => {
        if (key !== 'name') {
          settings[key] = values[key];
        }
      });

    // 先保存配置
    const connectorId = editingConnector?.id || `${connectorType}-${Date.now()}`;
    setTempConnectorId(connectorId);
    setSavedSettings(settings);
    setAuthStatus('authenticating');

    try {
      const connector = getConnectorInstance(connectorType, connectorId, settings);
      if (connector && 'authenticate' in connector) {
        await connector.authenticate();
        // OAuth流程会在handleOAuthCallback中完成
      } else {
        // S3 不需要OAuth
        setAuthStatus('authenticated');
        setCurrentStep(1);
      }
    } catch (error) {
      setAuthStatus('error');
      message.error(`${error}`);
    }
  };

  const handleDisconnect = async () => {
    if (!tempConnectorId || !savedSettings) return;

    try {
      const connector = getConnectorInstance(connectorType, tempConnectorId, savedSettings);
      if (connector && 'logout' in connector) {
        await connector.logout();
      }
      setAuthStatus('unauthenticated');
      setCurrentStep(0);
      message.success(t('cloudStorage.config.disconnected'));
    } catch (_error) {
      message.error(t('common.error'));
    }
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      const settings: Record<string, unknown> = {};
      Object.keys(values).forEach(key => {
        // 排除 name 和 authStatus，只保留实际的配置项
        if (key !== 'name' && key !== 'authStatus') {
          settings[key] = values[key];
        }
      });

      // 优先使用表单中的 authStatus，否则使用 state
      const finalAuthStatus = (values.authStatus as AuthStatus) || authStatus;

      const connector: Omit<StoredConnector, 'id' | 'createdAt'> = {
        name: values.name,
        type: connectorType,
        settings,
        authStatus: finalAuthStatus,
      };

      console.log('Saving connector with authStatus:', finalAuthStatus, connector);
      await onSubmit(connector);
      form.resetFields();
    } catch (error) {
      console.error('Form validation failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const renderSettingField = (field: { key: string; label: string; type: string; description?: string; required: boolean; placeholder?: string; options?: { label: string; value: string }[] }) => {
    switch (field.type) {
      case 'password':
        return (
          <Form.Item
            key={field.key}
            name={field.key}
            label={field.label}
            rules={[{ required: field.required, message: `${field.label} is required` }]}
            help={field.description}
          >
            <Input.Password placeholder={field.placeholder} />
          </Form.Item>
        );
      case 'number':
        return (
          <Form.Item
            key={field.key}
            name={field.key}
            label={field.label}
            rules={[{ required: field.required, message: `${field.label} is required` }]}
            help={field.description}
          >
            <InputNumber style={{ width: '100%' }} placeholder={field.placeholder} />
          </Form.Item>
        );
      case 'boolean':
        return (
          <Form.Item
            key={field.key}
            name={field.key}
            label={field.label}
            valuePropName="checked"
            help={field.description}
            initialValue={false}
          >
            <Switch />
          </Form.Item>
        );
      case 'select':
        return (
          <Form.Item
            key={field.key}
            name={field.key}
            label={field.label}
            rules={[{ required: field.required, message: `${field.label} is required` }]}
            help={field.description}
          >
            <Select placeholder={field.placeholder}>
              {field.options?.map(opt => (
                <Select.Option key={opt.value} value={opt.value}>
                  {opt.label}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
        );
      case 'url':
        return (
          <Form.Item
            key={field.key}
            name={field.key}
            label={field.label}
            rules={[
              { required: field.required, message: `${field.label} is required` },
              { type: 'url', message: 'Please enter a valid URL' },
            ]}
            help={field.description}
          >
            <Input placeholder={field.placeholder} />
          </Form.Item>
        );
      default:
        return (
          <Form.Item
            key={field.key}
            name={field.key}
            label={field.label}
            rules={[{ required: field.required, message: `${field.label} is required` }]}
            help={field.description}
          >
            <Input placeholder={field.placeholder} />
          </Form.Item>
        );
    }
  };

  const getAuthStatusTag = () => {
    switch (authStatus) {
      case 'authenticated':
        return <Alert type="success" message={t('cloudStorage.authenticated')} icon={<CheckCircleOutlined />} showIcon />;
      case 'authenticating':
        return <Alert type="info" message={t('cloudStorage.authenticating')} icon={<LoadingOutlined />} showIcon />;
      case 'expired':
        return <Alert type="warning" message={t('cloudStorage.expired')} showIcon />;
      case 'error':
        return <Alert type="error" message={t('cloudStorage.error')} showIcon />;
      default:
        return <Alert type="info" message={t('cloudStorage.unauthenticated')} showIcon />;
    }
  };

  return (
    <Modal
      title={editingConnector 
        ? t('cloudStorage.edit') 
        : t('cloudStorage.config.title', { name: connectorTypeInfo?.displayName || connectorType })}
      open={visible}
      onCancel={onCancel}
      footer={null}
      width={650}
      zIndex={1200}
    >
      {requiresOAuth && (
        <Steps
          current={currentStep}
          size="small"
          style={{ marginBottom: 24 }}
          items={[
            { title: t('cloudStorage.config.title', { name: '' }) },
            { title: t('cloudStorage.authenticated') },
          ]}
        />
      )}

      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
      >
        {/* 隐藏的 authStatus 字段，用于在测试连接成功后自动提交 */}
        <Form.Item name="authStatus" hidden>
          <Input />
        </Form.Item>

        <Form.Item
          name="name"
          label={t('cloudStorage.connectorName')}
          rules={[{ required: true, message: t('cloudStorage.validation.nameRequired') }]}
        >
          <Input placeholder={t('cloudStorage.namePlaceholder')} />
        </Form.Item>

        <Divider>{t('cloudStorage.type')}</Divider>

        {connectorTypeInfo?.requiredSettings.map(renderSettingField)}
        {connectorTypeInfo?.optionalSettings.map(renderSettingField)}

        {requiresOAuth && (
          <>
            <Divider>{t('cloudStorage.authenticated')}</Divider>
            
            {getAuthStatusTag()}

            <Form.Item style={{ marginTop: 16 }}>
              <Space>
                {authStatus === 'unauthenticated' || authStatus === 'expired' || authStatus === 'error' ? (
                  <Button
                    type="primary"
                    icon={<LoginOutlined />}
                    onClick={handleAuthenticate}
                  >
                    {t('cloudStorage.authenticated')}
                  </Button>
                ) : authStatus === 'authenticated' ? (
                  <Button
                    danger
                    icon={<DisconnectOutlined />}
                    onClick={handleDisconnect}
                  >
                    {t('cloudStorage.config.disconnect')}
                  </Button>
                ) : (
                  <Button loading disabled>
                    {t('cloudStorage.authenticating')}
                  </Button>
                )}
              </Space>
            </Form.Item>
          </>
        )}

        {!requiresOAuth && (
          <>
            <Divider>{t('cloudStorage.sync')}</Divider>

            <Form.Item>
              <Space>
                <Button onClick={handleTestConnection} loading={testing}>
                  {testing ? <LoadingOutlined /> : <CheckCircleOutlined />}
                  {' '}{t('cloudStorage.config.testConnection')}
                </Button>
                {testResult && (
                  <span style={{ color: testResult.success ? token.colorSuccess : token.colorError }}>
                    {testResult.message}
                  </span>
                )}
              </Space>
            </Form.Item>
          </>
        )}

        <Form.Item>
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button onClick={onCancel}>
              {t('common.cancel')}
            </Button>
            <Button 
              type="primary" 
              htmlType="submit" 
              loading={loading}
              disabled={requiresOAuth ? authStatus !== 'authenticated' : !testResult?.success && !editingConnector}
            >
              {editingConnector ? t('common.save') : t('cloudStorage.config.save')}
            </Button>
          </Space>
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default ConnectorConfigForm;