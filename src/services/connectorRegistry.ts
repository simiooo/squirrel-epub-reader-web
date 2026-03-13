/**
 * 连接器注册表初始化
 * 
 * 注册所有预置的云存储连接器
 */

import { globalConnectorRegistry } from './cloudStorageManager';
import { S3Connector } from './connectors/s3Connector';
import { DropboxConnector } from './connectors/dropboxConnector';
import { GoogleDriveConnector } from './connectors/googleDriveConnector';
import type { ConnectorTypeInfo } from '../types/cloudStorage';

// S3 连接器类型信息
const S3_TYPE_INFO: ConnectorTypeInfo = {
  type: 's3',
  displayName: 'S3 Compatible Storage',
  description: 'cloudStorage.s3Desc',
  authMethods: ['api_key'],
  requiredSettings: [
    { key: 'endpoint', label: 'Endpoint URL', type: 'url', required: true, placeholder: 'https://s3.amazonaws.com' },
    { key: 'bucket', label: 'Bucket Name', type: 'text', required: true, placeholder: 'my-bucket' },
    { key: 'accessKeyId', label: 'Access Key ID', type: 'text', required: true },
    { key: 'secretAccessKey', label: 'Secret Access Key', type: 'password', required: true },
  ],
  optionalSettings: [
    { key: 'region', label: 'Region', type: 'text', required: false, placeholder: 'us-east-1' },
    { key: 'rootPath', label: 'Sync Path', type: 'text', required: false, placeholder: '/SquirrelReader' },
  ],
};

// Dropbox 连接器类型信息
const DROPBOX_TYPE_INFO: ConnectorTypeInfo = {
  type: 'dropbox',
  displayName: 'Dropbox',
  description: 'cloudStorage.dropboxDesc',
  authMethods: ['oauth2'],
  requiredSettings: [
    { key: 'appKey', label: 'App Key', type: 'text', required: true, placeholder: 'Your Dropbox App Key' },
  ],
  optionalSettings: [
    { key: 'rootPath', label: 'Sync Path', type: 'text', required: false, placeholder: '/SquirrelReader' },
  ],
};

// Google Drive 连接器类型信息
const GOOGLE_DRIVE_TYPE_INFO: ConnectorTypeInfo = {
  type: 'googledrive',
  displayName: 'Google Drive',
  description: 'cloudStorage.googleDriveDesc',
  authMethods: ['oauth2'],
  requiredSettings: [
    { key: 'clientId', label: 'Client ID', type: 'text', required: true, placeholder: 'Your Google Client ID' },
  ],
  optionalSettings: [
    { key: 'rootPath', label: 'Folder Name', type: 'text', required: false, placeholder: 'SquirrelReader' },
  ],
};

// OneDrive 连接器类型信息（占位符）
const ONEDRIVE_TYPE_INFO: ConnectorTypeInfo = {
  type: 'onedrive',
  displayName: 'OneDrive',
  description: 'cloudStorage.oneDriveDesc',
  authMethods: ['oauth2'],
  requiredSettings: [
    { key: 'clientId', label: 'Client ID', type: 'text', required: true, placeholder: 'Your Microsoft Client ID' },
  ],
  optionalSettings: [
    { key: 'rootPath', label: 'Folder Name', type: 'text', required: false, placeholder: 'SquirrelReader' },
  ],
};

/**
 * 初始化连接器注册表
 */
export function initializeConnectors(): void {
  // 注册类型信息
  globalConnectorRegistry.registerTypeInfo('s3', S3_TYPE_INFO);
  globalConnectorRegistry.registerTypeInfo('dropbox', DROPBOX_TYPE_INFO);
  globalConnectorRegistry.registerTypeInfo('googledrive', GOOGLE_DRIVE_TYPE_INFO);
  globalConnectorRegistry.registerTypeInfo('onedrive', ONEDRIVE_TYPE_INFO);

  // 注册连接器构造函数
  globalConnectorRegistry.register('s3', S3Connector as never);
  globalConnectorRegistry.register('dropbox', DropboxConnector as never);
  globalConnectorRegistry.register('googledrive', GoogleDriveConnector as never);
  
  // OneDrive 连接器尚未实现
  // globalConnectorRegistry.register('onedrive', OneDriveConnector);
}

/**
 * 获取连接器类型信息
 */
export function getConnectorTypeInfo(type: string): ConnectorTypeInfo | undefined {
  return globalConnectorRegistry.getTypeInfo(type);
}

/**
 * 获取所有连接器类型
 */
export function getAllConnectorTypes(): ConnectorTypeInfo[] {
  return [
    S3_TYPE_INFO,
    DROPBOX_TYPE_INFO,
    GOOGLE_DRIVE_TYPE_INFO,
    ONEDRIVE_TYPE_INFO,
  ];
}