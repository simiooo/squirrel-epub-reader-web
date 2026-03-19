# 松鼠 EPUB 阅读器 (Squirrel EPUB Reader)

[中文](#简体中文) | [English](#english)

<span id="简体中文"></span>

在线访问：https://squirrel-epub-reader-web.vercel.app

一个优雅的 EPUB 电子书阅读器，支持云端同步，让你可以随时随地享受阅读。

## 功能特点

### 核心功能
- 📚 **EPUB 阅读**：支持 EPUB 格式电子书阅读
- ☁️ **云端同步**：支持 S3 兼容存储，同步书籍、阅读进度和书签
- 📱 **响应式设计**：适配桌面端和移动端设备
- 🌐 **多语言**：支持中文和英文界面

### 阅读体验
- 🔖 **书签管理**：轻松保存和管理阅读书签
- 📊 **阅读进度**：跨会话自动同步阅读进度
- ✌️ **手势操作**：支持捏合缩放、滑动翻页等手势控制
- 🎨 **美观界面**：现代设计，支持亮色/暗色主题

### 云存储支持

支持多种 S3 兼容存储服务：

| 存储服务 | 配置说明 |
|---------|---------|
| AWS S3 | 标准 S3 配置 |
| Cloudflare R2 | 推荐使用 Path-Style 访问 |
| Backblaze B2 | 需要配置 CORS |
| 阿里云 OSS | 标准 S3 兼容 |
| 腾讯云 COS | 标准 S3 兼容 |
| MinIO | 自建对象存储 |

详细配置请参考下方云存储配置指南。

## 快速开始

### 在线使用

直接访问：https://squirrel-epub-reader-web.vercel.app

### 本地开发

```bash
# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev

# 构建生产版本
pnpm build
```

### 环境要求

- Node.js 18+
- pnpm

## 技术栈

- **前端框架**：React + TypeScript + Vite
- **UI 组件库**：Ant Design
- **状态管理**：Zustand
- **本地存储**：IndexedDB (Dexie.js)
- **云端存储**：S3-compatible API
- **国际化**：i18next
- **构建工具**：R性llow (Vite 6+)

## 云存储配置指南

### 通用 S3 配置项

| 配置项 | 说明 | 示例 |
|-------|------|-----|
| **Endpoint** | S3 服务地址 | `https://s3.us-west-2.amazonaws.com` |
| **Bucket** | 存储桶名称 | `my-books` |
| **Region** | 服务区域 | `us-west-2` |
| **Access Key ID** | 访问密钥 | `AKIA...` |
| **Secret Access Key** | 秘密密钥 | `...` |
| **Force Path-Style** | 强制 Path-Style 访问 | 根据提供商选择 |
| **Root Path** | 应用数据根目录 | `/SquirrelReader` |

### 常见问题排查

**CORS 错误**
1. 启用 "Force Path-Style URL" 选项
2. 检查存储提供商的 CORS 配置
3. 清除浏览器缓存后重试

**连接失败**
1. 验证 Endpoint URL 格式
2. 检查 Access Key 和 Secret Key
3. 确保存储桶存在且可访问

## 项目结构

```
src/
├── components/          # React 组件
│   ├── cloud/           # 云存储相关组件
│   └── gesture/         # 手势操作组件
├── pages/               # 页面组件
├── stores/              # 状态管理
├── utils/               # 工具函数
├── db/                  # 数据库操作
├── types/               # TypeScript 类型定义
└── i18n/                # 国际化配置
```

## License

MIT

---

<span id="english"></span>

# Squirrel EPUB Reader

[中文](#简体中文) | [English](#english)

Online: https://squirrel-epub-reader-web.vercel.app

An elegant EPUB e-book reader with cloud sync support, letting you enjoy reading anytime, anywhere.

## Features

### Core Features
- 📚 **EPUB Reading**: Support for EPUB format e-books
- ☁️ **Cloud Sync**: S3-compatible storage sync for books, reading progress, and bookmarks
- 📱 **Responsive Design**: Works on desktop and mobile devices
- 🌐 **Multi-language**: Support for Chinese and English interfaces

### Reading Experience
- 🔖 **Bookmarks**: Save and manage reading bookmarks
- 📊 **Reading Progress**: Auto-sync reading progress across sessions
- ✌️ **Gesture Control**: Pinch to zoom, swipe to turn pages
- 🎨 **Beautiful UI**: Modern design with light/dark theme support

### Cloud Storage Support

Supports multiple S3-compatible storage services:

| Storage Service | Notes |
|----------------|-------|
| AWS S3 | Standard S3 configuration |
| Cloudflare R2 | Path-Style access recommended |
| Backblaze B2 | CORS configuration required |
| Alibaba Cloud OSS | Standard S3-compatible |
| Tencent Cloud COS | Standard S3-compatible |
| MinIO | Self-hosted object storage |

## Quick Start

### Online

Visit: https://squirrel-epub-reader-web.vercel.app

### Local Development

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Build for production
pnpm build
```

### Requirements

- Node.js 18+
- pnpm

## Tech Stack

- **Framework**: React + TypeScript + Vite
- **UI Library**: Ant Design
- **State Management**: Zustand
- **Local Storage**: IndexedDB (Dexie.js)
- **Cloud Storage**: S3-compatible API
- **Internationalization**: i18next
- **Build**: Rolldown (Vite 6+)

## Cloud Storage Configuration

### General S3 Settings

| Setting | Description | Example |
|---------|-------------|---------|
| **Endpoint** | S3 service endpoint URL | `https://s3.us-west-2.amazonaws.com` |
| **Bucket** | Storage bucket name | `my-books` |
| **Region** | Service region | `us-west-2` |
| **Access Key ID** | Your access key | `AKIA...` |
| **Secret Access Key** | Your secret key | `...` |
| **Force Path-Style** | Use path-style URLs | Varies by provider |
| **Root Path** | Base directory for app data | `/SquirrelReader` |

### Troubleshooting

**CORS Errors**
1. Enable "Force Path-Style URL" option
2. Check CORS configuration on your storage provider
3. Clear browser cache and retry

**Connection Failed**
1. Verify endpoint URL format
2. Check Access Key and Secret Key
3. Ensure bucket exists and is accessible

## Project Structure

```
src/
├── components/          # React components
│   ├── cloud/          # Cloud storage components
│   └── gesture/        # Gesture control components
├── pages/              # Page components
├── stores/             # State management
├── utils/              # Utility functions
├── db/                 # Database operations
├── types/              # TypeScript types
└── i18n/               # Internationalization
```

## License

MIT
