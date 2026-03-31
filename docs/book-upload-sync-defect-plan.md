# 书籍上传与同步策略 - 缺陷修复计划

> 文档版本: v2.0  
> 创建时间: 2026-03-31  
> 更新时间: 2026-03-31  
> 范围: S3 云存储 + 本地 EPUB/PDF 上传 + 云书架同步 + 幂等性检查

---

## 优先级定义

| 级别 | 说明 | 响应要求 |
|------|------|----------|
| P0 - 致命 | 核心功能不可用或数据丢失风险 | 立即修复 |
| P1 - 严重 | 核心功能可用但体验严重受损 | 本迭代修复 |
| P2 - 中等 | 功能可用但有明显缺陷 | 下迭代修复 |
| P3 - 轻微 | 体验优化或边界场景 | 后续排期 |

---

## 当前实现状态速查

| 模块 | 文件 | 已实现 | 缺失/不完整 |
|------|------|--------|------------|
| S3 连接器 | `s3Connector.ts` | uploadProgress, downloadProgress, uploadBookmarks, downloadBookmarks, uploadBookWithParts, downloadBookWithParts, testConnection, listBooks | 无分片上传/断点续传, 无原子上传, 无分页(listBooks>1000截断), withRetry未使用 |
| 基类连接器 | `baseCloudStorageConnector.ts` | sync(), syncBook(), withRetry, emitSyncProgress, 事件系统 | sync()调用的私有方法子类无法override(设计缺陷), syncSingleBook等抛异常 |
| 同步服务 | `bookSyncService.ts` | uploadBookToCloud, downloadBookFromCloud, refreshCloudBooks, syncAllCloudBooks, syncCloudBookParts | 无进度/书签同步调用, 无deleteFromCloud, 冲突处理不完整 |
| 数据库 | `db/index.ts` | books, progress, bookmarks, connectors, cloudBooks, syncRecords 表 | 无uploadSessions表, 无批量操作 |
| 哈希工具 | `bookHash.ts` | generateFileHash, generateBookId, generateChecksum, verifyChecksum, generateQuickHash | 无流式哈希, 无Web Worker, 大文件阻塞主线程 |
| 管理器 | `cloudStorageManager.ts` | 连接器注册/注销, syncAll, syncConnector, syncBookToAll, 事件系统 | 无持久化(刷新丢失), syncBookToAll无并发控制 |

---

## P0 - 致命缺陷

### P0-1: 大文件无分片上传/断点续传

**用户故事**: 作为用户，我想上传一本 200MB 的 PDF 电子书到 S3 云书架。

**问题描述**: 
- `uploadBookWithParts()` 使用 S3 `PutObjectCommand` 单次上传整个文件
- 网络中断后需从头开始，浪费流量和时间
- 浏览器环境大文件上传容易触发超时或内存溢出

**影响范围**: 所有 >20MB 的 EPUB/PDF 文件上传和下载

**修复方案**:

1. **分片上传**（使用 `@aws-sdk/lib-storage` 的 `Upload` 类）
   - 阈值: 文件 > 20MB 启用分片
   - 分片大小: 5MB/片
   - 流程: `CreateMultipartUploadCommand` → `UploadPartCommand` → `CompleteMultipartUploadCommand`

2. **断点续传**
   - 在 IndexedDB 新增 `uploadSessions` 表记录 `uploadSession`
   - 恢复时调用 `ListPartsCommand` 获取已上传分片，仅上传剩余部分
   - 上传中断后页面刷新仍可恢复

3. **下载端断点续传**
   - 使用 `GetObjectCommand` 的 `Range` 参数
   - 分段下载后使用 Blob 拼接

**数据流**:

```
用户触发上传
  → bookSyncService.uploadBookToCloud()
    → s3Connector.uploadBookWithParts()
      → 判断文件大小 > 20MB?
        → 是: 进入分片上传流程
          → 检查 uploadSessions 是否有中断记录
            → 有: 调用 ListPartsCommand 获取已上传分片
            → 无: 调用 CreateMultipartUploadCommand 创建新 session
          → 循环 UploadPartCommand 上传每个分片
          → 全部完成后 CompleteMultipartUploadCommand
          → 清理 uploadSessions 记录
        → 否: 使用 PutObjectCommand 直接上传
```

**新增/修改方法签名**:

```typescript
// s3Connector.ts
private uploadWithMultipart(key: string, blob: Blob, onProgress?: (progress: UploadProgress) => void): Promise<void>
private resumeMultipartUpload(key: string, uploadId: string, blob: Blob, onProgress?: (progress: UploadProgress) => void): Promise<void>
private downloadWithRange(key: string, onProgress?: (progress: DownloadProgress) => void): Promise<Blob>
private saveUploadSession(session: UploadSession): Promise<void>
private clearUploadSession(uploadId: string): Promise<void>

// db/index.ts
addUploadSession(session: UploadSession): Promise<string>
getUploadSession(uploadId: string): Promise<UploadSession | undefined>
deleteUploadSession(uploadId: string): Promise<void>
```

**新类型定义**:

```typescript
interface UploadSession {
  uploadId: string;
  bookId: string;
  connectorId: string;
  key: string;
  totalSize: number;
  uploadedParts: number[];
  totalParts: number;
  partSize: number;
  createdAt: number;
  expiresAt: number;
}

interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
  speed: number; // bytes/sec
}

interface DownloadProgress {
  loaded: number;
  total: number;
  percent: number;
}
```

**涉及文件**:
- `src/services/connectors/s3Connector.ts` (核心修改)
- `src/services/baseCloudStorageConnector.ts` (新增抽象方法)
- `src/db/index.ts` (新增 `uploadSessions` 表)
- `src/types/cloudStorage.ts` (新增类型)

**验收标准**:
- [ ] 100MB 文件上传中断后，刷新页面可从断点恢复
- [ ] 上传进度实时更新（精度 ±1%，延迟 < 200ms）
- [ ] 网络恢复后自动续传（无需用户操作，恢复延迟 < 3s）
- [ ] 分片上传成功率 > 99%（100次上传测试）
- [ ] 内存占用峰值 < 100MB（上传 200MB 文件时）

**回滚方案**:
- 保留原有 `PutObjectCommand` 路径作为 fallback
- 新增 `useMultipart` 配置开关，默认开启，可降级为单次上传
- 回滚时删除 `uploadSessions` 表数据

**测试策略**:
- 单元测试: 模拟 `ListPartsCommand` 返回部分分片，验证续传逻辑
- 集成测试: 使用 MinIO 本地 S3 服务，模拟网络中断（切断网络 5s 后恢复）
- 性能测试: 上传 50MB/100MB/200MB 文件，记录内存、时间、成功率

---

### P0-2: 三部分上传非原子性导致数据不一致

**用户故事**: 作为用户，我把一本书上传到云书架，但上传过程中网络波动。

**问题描述**:
- 书籍文件、封面、元数据分三次 `PutObjectCommand` 上传
- 如果书籍上传成功但封面/元数据失败，云端存在不完整的书籍记录
- 下载端可能下载到无封面或无元数据的"残书"

**影响范围**: 所有云上传操作

**修复方案**:

1. **临时目录 + 原子移动**
   - 上传到 `{rootPath}/_temp/{uploadId}/` 目录
   - 三部分全部成功后，使用 `CopyObjectCommand` 服务端复制到目标路径
   - 复制完成后 `DeleteObjectCommand` 清理临时文件

2. **完整性校验**
   - 上传完成后立即调用 `HeadObjectCommand` 验证三部分均存在
   - 不完整则清理临时文件，标记上传失败

3. **垃圾清理**
   - 定期扫描 `_temp/` 目录，清理超过 24 小时的残留文件
   - 每次 `listBooks()` 时附带清理逻辑

**数据流**:

```
开始上传
  → 生成 uploadId (UUID)
  → 上传到 _temp/{uploadId}/books/{bookId}.epub
  → 上传到 _temp/{uploadId}/covers/{bookId}.jpg
  → 上传到 _temp/{uploadId}/metadata/{bookId}.json
  → 三部分全部成功?
    → 是: 
      → CopyObjectCommand: _temp/{uploadId}/books/* → books/{bookId}.epub
      → CopyObjectCommand: _temp/{uploadId}/covers/* → covers/{bookId}.jpg
      → CopyObjectCommand: _temp/{uploadId}/metadata/* → metadata/{bookId}.json
      → DeleteObjectCommand: 清理 _temp/{uploadId}/ 下所有文件
      → 返回成功
    → 否:
      → DeleteObjectCommand: 清理 _temp/{uploadId}/ 下所有文件
      → 抛出 UploadIncompleteError
```

**新增/修改方法签名**:

```typescript
// s3Connector.ts
private uploadToTemp(uploadId: string, type: 'book' | 'cover' | 'metadata', data: Blob | string): Promise<void>
private commitUpload(uploadId: string, bookId: string): Promise<void>
private rollbackUpload(uploadId: string): Promise<void>
private cleanupTempFiles(maxAge: number): Promise<number>
```

**涉及文件**:
- `src/services/connectors/s3Connector.ts` (核心修改)
- `src/services/bookSyncService.ts` (调用原子上传)

**验收标准**:
- [ ] 上传失败后云端不残留不完整数据（验证 _temp/ 目录为空）
- [ ] 下载端不会下载到残缺的书籍记录（listBooks 不返回不完整书籍）
- [ ] 临时文件 24 小时内自动清理
- [ ] 原子移动成功率 > 99.9%

**回滚方案**:
- 保留原有直接上传路径作为 fallback
- 新增 `useAtomicUpload` 配置开关
- 回滚时不清理 _temp/ 目录，手动检查残留

**测试策略**:
- 单元测试: 模拟三部分上传中某一部分失败，验证 rollback 逻辑
- 集成测试: 在上传第二部分时切断网络，验证 _temp/ 目录最终为空
- 边界测试: 并发上传同一本书，验证不会互相干扰

---

### P0-3: S3 凭证明文存储在 IndexedDB

**用户故事**: 作为用户，我配置了 S3 连接器，但我的电脑被他人使用。

**问题描述**:
- AccessKeyId 和 SecretAccessKey 明文存储在 `connectors` 表中
- XSS 攻击可直接读取凭证
- 多人共用设备时凭证泄露

**影响范围**: 所有 S3 连接器配置

**修复方案**:

1. **加密存储**（使用 Web Crypto API）
   - 用户设置主密码 → PBKDF2 派生加密密钥（100,000 次迭代）
   - 使用 AES-GCM 加密 `secretAccessKey` 和 `accessKeyId`
   - 加密后的密文 + salt + iv 存储在 IndexedDB
   - 无主密码时使用设备指纹 + 时间戳派生弱密钥（防简单读取）

2. **解密流程**
   - 使用凭证时提示输入主密码
   - 解密失败次数限制（5 次后锁定 30 分钟）
   - 解密成功后缓存明文密钥到内存（页面关闭后清除）

3. **主密码管理**
   - 首次配置时要求设置主密码
   - 提供"修改主密码"功能（需先解密再重新加密）
   - 提供"重置连接器"功能（遗忘主密码时清除凭证重新配置）

**加密流程**:

```
用户输入主密码
  → 获取或生成 salt (16 bytes, 随机)
  → PBKDF2(masterPassword, salt, 100000, 256, 'AES-GCM')
  → 生成 iv (12 bytes, 随机)
  → AES-GCM.encrypt(secretAccessKey, key, iv)
  → 存储: { encryptedKey, salt, iv, iterations: 100000 }
```

**解密流程**:

```
用户输入主密码
  → 从 DB 读取 { encryptedKey, salt, iv, iterations }
  → PBKDF2(masterPassword, salt, iterations, 256, 'AES-GCM')
  → AES-GCM.decrypt(encryptedKey, key, iv)
  → 返回明文密钥（缓存到内存）
```

**新增/修改方法签名**:

```typescript
// 新增文件: src/utils/crypto.ts
export function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey>
export function encryptSecret(plaintext: string, password: string): Promise<EncryptedPayload>
export function decryptSecret(payload: EncryptedPayload, password: string): Promise<string>
export function generateSalt(): Uint8Array
export function generateIv(): Uint8Array

// 类型定义
interface EncryptedPayload {
  ciphertext: string;  // base64
  salt: string;        // base64
  iv: string;          // base64
  iterations: number;
}

// db/index.ts 修改
interface StoredConnector {
  // ... 原有字段
  encryptedSettings?: Record<string, EncryptedPayload>;  // 新增
  settingsDecrypted?: boolean;  // 新增，标记当前内存中是否已解密
}

// s3Connector.ts 修改
private decryptCredentials(password: string): Promise<void>
private encryptCredentials(password: string): Promise<void>
```

**涉及文件**:
- `src/utils/crypto.ts` (新增)
- `src/services/connectors/s3Connector.ts` (修改凭证存取逻辑)
- `src/services/cloudStorageManager.ts` (修改连接器初始化)
- `src/db/index.ts` (修改 StoredConnector 结构)
- `src/components/cloud/ConnectorConfigForm.tsx` (新增主密码输入)

**验收标准**:
- [ ] IndexedDB 中 `secretAccessKey` 字段值为加密后的 base64 字符串（非明文）
- [ ] 使用凭证时需解密，解密失败提示重新输入主密码
- [ ] 主密码错误 5 次后锁定 30 分钟
- [ ] 加密/解密操作耗时 < 500ms（100,000 次 PBKDF2 迭代）
- [ ] 页面关闭后内存中的明文密钥自动清除

**回滚方案**:
- 提供迁移脚本：加密所有现有明文凭证
- 保留 `settings` 字段兼容旧数据，新增 `encryptedSettings` 字段
- 回滚时从 `settings` 读取明文（如果存在）

**测试策略**:
- 单元测试: 验证同一明文 + 不同 salt 产生不同密文
- 单元测试: 验证错误密码解密抛出异常
- 集成测试: 配置连接器 → 刷新页面 → 输入密码 → 验证连接正常
- 安全测试: 验证 XSS 无法直接读取明文密钥

---

### P0-4: 阅读进度与书签同步实现不完整

**用户故事**: 作为用户，我在手机上读到了第 5 章，想在电脑上继续阅读。

**问题描述**:
- `baseCloudStorageConnector.ts` 的 `sync()` 方法调用的私有方法（`syncSingleBook`, `syncSingleBookProgress`, `syncSingleBookBookmarks`）全部抛异常
- 这些方法是 `private` 的，子类无法 override
- `s3Connector.ts` 已实现 uploadProgress/downloadProgress/uploadBookmarks/downloadBookmarks 方法，但未被 `sync()` 调用
- 冲突解决策略未实现（进度取最大值、书签合并去重）

**影响范围**: 所有跨设备阅读场景

**修复方案**:

1. **修复基类设计缺陷**
   - 将 `syncSingleBook`, `syncSingleBookProgress`, `syncSingleBookBookmarks` 从 `private` 改为 `protected`
   - 或改为 `abstract protected` 强制子类实现

2. **在 `s3Connector.ts` 中实现同步方法**
   - 已有 uploadProgress/downloadProgress/uploadBookmarks/downloadBookmarks
   - 需要实现 `syncSingleBookProgress` 和 `syncSingleBookBookmarks`

3. **冲突解决策略**
   - 进度: `merge` 策略 — 取最大阅读进度（页码/百分比），取最新阅读时间
   - 书签: `merge` 策略 — 按 `chapterId + position` 去重合并，不覆盖只增量添加

**数据流**:

```
syncBook(bookId)
  → 同步书籍文件 (已有)
  → 同步进度:
    → 获取本地进度: db.getProgress(bookId)
    → 获取云端进度: connector.downloadProgress(bookId)
    → 比较 lastReadAt:
      → 云端更新: 下载云端进度到本地
      → 本地更新: 上传本地进度到云端
      → 都有更新: 合并（取最大 currentPosition, 最新 lastReadAt）
  → 同步书签:
    → 获取本地书签: db.getBookmarks(bookId)
    → 获取云端书签: connector.downloadBookmarks(bookId)
    → 合并: 按 chapterId + position 去重
    → 上传差异到云端
    → 更新本地数据库
```

**新增/修改方法签名**:

```typescript
// baseCloudStorageConnector.ts 修改
protected abstract syncSingleBook(bookId: string, options?: SyncOptions): Promise<void>
protected abstract syncSingleBookProgress(bookId: string, options?: SyncOptions): Promise<void>
protected abstract syncSingleBookBookmarks(bookId: string, options?: SyncOptions): Promise<void>

// s3Connector.ts 新增
protected async syncSingleBookProgress(bookId: string, options?: SyncOptions): Promise<void>
protected async syncSingleBookBookmarks(bookId: string, options?: SyncOptions): Promise<void>

// bookSyncService.ts 新增
async syncProgress(bookId: string, connector: CloudStorageConnector): Promise<SyncProgressResult>
async syncBookmarks(bookId: string, connector: CloudStorageConnector): Promise<SyncBookmarkResult>

// 新增类型
interface SyncProgressResult {
  success: boolean;
  strategy: 'local_wins' | 'remote_wins' | 'merge';
  localVersion?: CloudReadingProgress;
  remoteVersion?: CloudReadingProgress;
  mergedVersion?: CloudReadingProgress;
}

interface SyncBookmarkResult {
  success: boolean;
  added: number;
  removed: number;
  merged: number;
}
```

**涉及文件**:
- `src/services/baseCloudStorageConnector.ts` (修复 private → protected)
- `src/services/connectors/s3Connector.ts` (实现同步方法)
- `src/services/bookSyncService.ts` (新增进度/书签同步调用)
- `src/types/cloudStorage.ts` (新增同步结果类型)

**验收标准**:
- [ ] 设备 A 阅读进度同步到设备 B（延迟 < 5s）
- [ ] 设备 A 添加的书签在设备 B 可见
- [ ] 进度冲突时正确合并（取最大 currentPosition 和最新 lastReadAt）
- [ ] 书签不丢失、不重复（合并后书签数量 = 本地 ∪ 云端）
- [ ] 同步失败时保留本地数据，不覆盖

**回滚方案**:
- 进度同步失败时保留本地进度，不上传
- 书签同步失败时保留本地书签，不从云端删除
- 提供"强制使用本地"和"强制使用云端"选项

**测试策略**:
- 单元测试: 模拟进度冲突（本地 chapter 5, 云端 chapter 8），验证合并结果
- 单元测试: 模拟书签合并（本地 3 个书签，云端 5 个，2 个重复），验证去重后 6 个
- 集成测试: 两个设备同时阅读同一本书，验证最终一致性

---

## P1 - 严重缺陷

### P1-1: 大文件导入本地书架无进度反馈

**用户故事**: 作为用户，我导入了一本 300MB 的 PDF 电子书到本地书架。

**问题描述**:
- `generateFileHash()` 对完整文件计算 SHA-256，大文件耗时较长
- 计算过程中 UI 无进度提示，用户以为卡死
- 阻塞主线程，页面无法响应

**修复方案**:

1. **分块哈希计算**（使用 `crypto.subtle.digest` 的流式能力）
   - 创建 `src/workers/hashWorker.ts`
   - 分块读取文件（每块 1MB），逐步更新哈希
   - 通过 `postMessage` 回传进度

2. **UI 进度显示**
   - 显示进度条和预估剩余时间
   - 允许取消哈希计算

**涉及文件**:
- `src/utils/bookHash.ts`
- `src/components/BookImport.tsx`
- 新增: `src/workers/hashWorker.ts`

**验收标准**:
- [ ] 300MB 文件哈希计算期间 UI 保持响应（FPS > 30）
- [ ] 显示实时进度百分比（精度 ±1%）
- [ ] 主线程不阻塞
- [ ] 支持取消操作

**回滚方案**:
- 保留原有同步哈希计算作为 fallback
- 新增 `useWorker` 配置开关

---

### P1-2: 上传失败无重试策略

**用户故事**: 作为用户，我在网络不稳定的环境下上传书籍到云书架。

**问题描述**:
- `uploadBookToCloud()` 直接调用 connector 上传方法，无重试逻辑
- `baseCloudStorageConnector.ts` 有 `withRetry` wrapper，但未被上传方法调用
- 网络抖动导致上传失败后用户需手动重试

**修复方案**:

1. 在 `uploadBookToCloud()` 中应用 `withRetry`
2. 重试策略:
   - 默认重试 3 次
   - 指数退避: 1s → 2s → 4s
   - 仅重试网络错误（超时、连接重置），不重试认证错误

**涉及文件**:
- `src/services/bookSyncService.ts`
- `src/services/baseCloudStorageConnector.ts`

**验收标准**:
- [ ] 网络抖动时自动重试 3 次
- [ ] 重试间隔指数增长
- [ ] 认证错误不重试，直接报错

---

### P1-3: 元数据变更不触发同步

**用户故事**: 作为用户，我修改了本地书籍的标题和标签，希望同步到云书架。

**问题描述**:
- 幂等性检查仅基于文件内容的 SHA-256 checksum
- 文件内容未变但元数据变更时，checksum 相同，不会触发同步
- 云端元数据与本地不一致

**修复方案**:

1. 新增 `metadataChecksum` 字段（已存在于 `StoredCloudBook` 类型中）
2. 上传前比较本地 `metadataChecksum` 与云端 `metadataChecksum`
3. 如不同，仅上传元数据部分
4. 增加"仅同步元数据"的快捷操作

**涉及文件**:
- `src/services/bookSyncService.ts`
- `src/utils/bookHash.ts` (新增 `generateMetadataChecksum()`)

**验收标准**:
- [ ] 修改书籍标题后能检测到元数据变更
- [ ] 仅元数据变更时只上传元数据 JSON
- [ ] 云端元数据与本地一致

---

### P1-4: 上传中无进度回调

**用户故事**: 作为用户，我上传一本书到云书架，想看到上传进度。

**问题描述**:
- `uploadBookToCloud()` 无进度回调机制
- 用户无法知道上传状态（等待中、上传中、已完成）
- 大文件体验极差

**修复方案**:

1. 使用 `@aws-sdk/lib-storage` 的 `Upload` 类，内置进度回调
2. 进度信息通过回调函数传递到 UI 层
3. UI 显示: 已上传大小 / 总大小 / 百分比 / 速度

**涉及文件**:
- `src/services/connectors/s3Connector.ts`
- `src/services/bookSyncService.ts`
- `src/components/cloud/SyncToCloudModal.tsx`

**验收标准**:
- [ ] 上传时显示实时进度条
- [ ] 显示已上传大小和总大小
- [ ] 显示预估剩余时间

---

## P2 - 中等缺陷

### P2-1: 跨连接器去重缺失

**问题描述**: `findCloudBookByChecksum()` 仅检查同一 connector 内的重复，同一本书上传到多个 S3 bucket 不会互相感知。

**修复方案**: 
- 查询所有 connector 的 `cloudBooks` 表，检查 checksum 是否已存在于任何 connector
- 上传前提示用户"该书已存在于 [Connector Name] 中"

**涉及文件**: `src/services/bookSyncService.ts`, `src/db/index.ts`

---

### P2-2: Checksum 计算性能浪费

**问题描述**: `Book` 对象已有 `checksum` 字段，但 `uploadBookToCloud()` 重新计算而非复用。

**修复方案**:
- 优先使用 `book.checksum`，仅在缺失时重新计算
- 下载时同理

**涉及文件**: `src/services/bookSyncService.ts`

---

### P2-3: S3 无连接测试

**问题描述**: 添加 S3 连接器时已有 `testConnection()` 方法，但 UI 中未暴露"Test Connection"按钮。

**修复方案**:
- 在 `ConnectorConfigForm.tsx` 增加"测试连接"按钮
- 调用 `s3Connector.testConnection()` 验证
- 显示测试结果（成功/失败 + 错误信息）

**涉及文件**: `src/services/connectors/s3Connector.ts`, `src/components/cloud/ConnectorConfigForm.tsx`

---

### P2-4: 冲突解决后 syncStatus 未正确更新

**问题描述**: 用户选择"use remote"解决冲突后，`syncStatus` 可能未更新为 `synced`。

**修复方案**:
- 冲突解决完成后强制更新 `syncStatus` 为 `synced`
- 更新 `localModifiedAt` 和 `remoteModifiedAt`

**涉及文件**: `src/services/bookSyncService.ts`

---

### P2-5: 下载后未触发阅读进度同步

**问题描述**: 下载书籍后，云端的阅读进度/书签未自动同步到本地。

**修复方案**:
- `downloadBookFromCloud()` 完成后，自动调用 `downloadProgress()` 和 `downloadBookmarks()`
- 合并到本地数据库

**涉及文件**: `src/services/bookSyncService.ts`

---

### P2-6: 上传并发控制缺失

**问题描述**: 批量上传多本书时可能同时发起大量 S3 请求触发限流。

**修复方案**:
- 实现并发队列，最大并发数 3
- 使用自实现队列（避免引入新依赖）

**涉及文件**: `src/services/bookSyncService.ts`

---

## P3 - 轻微缺陷

### P3-1: 无上传大小限制提示

**问题描述**: 未检查浏览器 IndexedDB 配额，可能导致存储失败。

**修复方案**: 使用 `navigator.storage.estimate()` 检查可用空间，上传前提示。

---

### P3-2: 重复下载无提示

**问题描述**: 本地已有相同 checksum 的书时，下载操作静默跳过，用户无感知。

**修复方案**: 提示"该书已存在于本地书架中"。

---

### P3-3: generateBookId 依赖 metadata hash 导致重复

**问题描述**: 同一文件不同 metadata 生成不同 bookId，云端可能出现重复文件。

**修复方案**: `bookId` 仅基于文件内容 hash，metadata hash 用于版本控制。

---

### P3-4: S3 CORS 配置依赖

**问题描述**: 浏览器直连 S3 需要正确 CORS 配置，用户可能不知道。

**修复方案**: 
- 在连接器配置页面提供 CORS 配置示例
- 连接测试时检测 CORS 错误并给出友好提示

---

### P3-5: 文件格式二次校验

**问题描述**: 用户可能修改文件扩展名绕过格式检查。

**修复方案**: `validate()` 方法增加文件头魔法数字检查（EPUB: `PK\x03\x04`, PDF: `%PDF-`）。

---

## 任务依赖图

```
迭代 1 (P0-1, P0-2, P0-4)
├── P0-1: 分片上传/断点续传
│   ├── [前置] db/index.ts: 新增 uploadSessions 表
│   ├── [前置] types/cloudStorage.ts: 新增 UploadSession, UploadProgress 类型
│   ├── [核心] s3Connector.ts: 实现 multipart upload + resume
│   └── [集成] bookSyncService.ts: 调用分片上传方法
│
├── P0-2: 原子上传
│   ├── [依赖] P0-1 (复用分片上传逻辑)
│   ├── [核心] s3Connector.ts: 实现 temp + commit/rollback
│   └── [集成] bookSyncService.ts: 调用原子上传
│
└── P0-4: 进度/书签同步
    ├── [前置] baseCloudStorageConnector.ts: private → protected
    ├── [核心] s3Connector.ts: 实现 syncSingleBookProgress/Bookmarks
    ├── [集成] bookSyncService.ts: 新增 syncProgress/syncBookmarks 调用
    └── [UI] SyncToCloudModal.tsx: 显示同步状态

迭代 2 (P0-3, P1-1, P1-2, P1-4)
├── P0-3: 凭证加密
│   ├── [前置] utils/crypto.ts: 新增加密工具函数
│   ├── [核心] s3Connector.ts: 修改凭证存取逻辑
│   ├── [DB] db/index.ts: 修改 StoredConnector 结构
│   └── [UI] ConnectorConfigForm.tsx: 新增主密码输入
│
├── P1-1: Web Worker 哈希
│   ├── [新增] workers/hashWorker.ts
│   ├── [修改] utils/bookHash.ts: 支持 Worker 模式
│   └── [UI] BookImport.tsx: 显示哈希进度
│
├── P1-2: 重试策略
│   └── [修改] bookSyncService.ts: 应用 withRetry
│
└── P1-4: 上传进度回调
    ├── [依赖] P0-1 (复用 UploadProgress)
    └── [UI] SyncToCloudModal.tsx: 显示进度条

迭代 3 (P1-3, P2-1, P2-3, P2-5)
├── P1-3: 元数据变更同步
│   ├── [修改] utils/bookHash.ts: 新增 generateMetadataChecksum
│   └── [修改] bookSyncService.ts: 比较 metadataChecksum
│
├── P2-1: 跨连接器去重
│   └── [修改] bookSyncService.ts: 查询所有 connector
│
├── P2-3: 连接测试按钮
│   └── [UI] ConnectorConfigForm.tsx: 新增测试按钮
│
└── P2-5: 下载后同步进度
    └── [修改] bookSyncService.ts: downloadBookFromCloud 后调用 sync

迭代 4 (P2-2, P2-4, P2-6, P3 全部)
├── P2-2: 复用 checksum
├── P2-4: syncStatus 更新
├── P2-6: 并发控制
└── P3-1 ~ P3-5: 体验优化
```

---

## 修复排期建议

| 迭代 | 包含缺陷 | 预计工时 | 关键里程碑 |
|------|----------|----------|------------|
| 迭代 1 (本周) | P0-1, P0-2, P0-4 | 5-7 天 | 大文件可上传、上传原子性、进度/书签可同步 |
| 迭代 2 (下周) | P0-3, P1-1, P1-2, P1-4 | 5-7 天 | 凭证加密、哈希不卡顿、自动重试、进度可见 |
| 迭代 3 | P1-3, P2-1, P2-3, P2-5 | 3-5 天 | 元数据同步、跨连接器去重、连接测试、下载后同步 |
| 迭代 4 | P2-2, P2-4, P2-6, P3 全部 | 3-5 天 | 性能优化、体验完善 |

---

## 新增数据库表结构

### `uploadSessions` 表 (P0-1 断点续传)

```typescript
interface UploadSession {
  uploadId: string;          // S3 multipart upload ID
  bookId: string;            // 书籍 ID
  connectorId: string;       // 连接器 ID
  key: string;               // S3 object key
  totalSize: number;         // 文件总大小 (bytes)
  uploadedParts: number[];   // 已上传的分片索引 [0, 1, 2, ...]
  totalParts: number;        // 总分片数
  partSize: number;          // 每片大小 (bytes)
  createdAt: number;         // 创建时间戳 (ms)
  expiresAt: number;         // S3 upload session 过期时间戳 (ms)
}
```

**Dexie 表定义**:

```typescript
this.version(6).stores({
  uploadSessions: 'uploadId, bookId, connectorId, key, createdAt'
});
```

---

## 测试策略

### 单元测试

| 模块 | 测试文件 | 覆盖场景 |
|------|----------|----------|
| s3Connector | `s3Connector.test.ts` | 分片上传、断点续传、原子上传、进度/书签同步 |
| bookSyncService | `bookSyncService.test.ts` | 上传/下载流程、冲突解决、重试逻辑 |
| crypto | `crypto.test.ts` | 加密/解密、密钥派生、错误处理 |
| bookHash | `bookHash.test.ts` | 流式哈希、Worker 模式、大文件处理 |

### 集成测试

| 场景 | 工具 | 验证点 |
|------|------|--------|
| S3 上传/下载 | MinIO (本地 S3) | 分片上传成功率、断点续传、原子上传 |
| 进度同步 | 模拟多设备 | 冲突合并、书签去重 |
| 凭证加密 | Mock IndexedDB | 加密存储、解密验证、错误密码锁定 |

### E2E 测试

| 场景 | 工具 | 验证点 |
|------|------|--------|
| 完整上传流程 | Playwright | 选择文件 → 上传 → 验证云端存在 → 下载 → 验证本地存在 |
| 跨设备同步 | Playwright (多浏览器) | 设备 A 上传 → 设备 B 同步 → 验证进度/书签一致 |
| 网络中断恢复 | Playwright + 网络模拟 | 上传中切断网络 → 恢复 → 验证续传成功 |

---

## 风险与依赖

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| S3 Multipart Upload 在浏览器环境兼容性 | P0-1 无法实施 | 使用 `@aws-sdk/lib-storage` 已验证支持浏览器 |
| Web Worker 哈希计算增加复杂度 | P1-1 实施成本 | 优先使用 `crypto.subtle.digest` 分块方案 |
| 加密存储主密码遗忘 | P0-3 用户体验 | 提供"重置连接器"选项，重新输入凭证 |
| 进度/书签同步逻辑复杂 | P0-4 测试成本 | 编写单元测试覆盖合并策略 |
| `@aws-sdk/lib-storage` 包体积增加 | 构建体积 | 按需导入，tree-shaking 验证 |
| Dexie 版本升级 (v5→v6) | 数据迁移 | 编写迁移脚本，验证旧数据兼容 |

---

## 监控与可观测性

### 关键指标

| 指标 | 计算方式 | 告警阈值 |
|------|----------|----------|
| 上传成功率 | 成功上传数 / 总上传数 | < 95% |
| 平均上传速度 | 总上传大小 / 总耗时 | < 1MB/s |
| 断点续传触发率 | 续传次数 / 总上传次数 | > 10% |
| 同步延迟 | 本地修改到云端可见的时间 | > 30s |
| 凭证解密失败率 | 解密失败次数 / 总解密次数 | > 5% |

### 日志规范

```typescript
// 上传日志
console.log('[Upload] bookId=%s size=%d parts=%d connector=%s', bookId, size, parts, connectorId);
console.log('[Upload] progress=%d%% speed=%dKB/s eta=%ds', percent, speed, eta);
console.log('[Upload] complete bookId=%s duration=%dms', bookId, duration);
console.error('[Upload] failed bookId=%s error=%s retry=%d', bookId, error.message, retryCount);

// 同步日志
console.log('[Sync] progress bookId=%s strategy=%s local=%s remote=%s', bookId, strategy, localAt, remoteAt);
console.log('[Sync] bookmarks bookId=%s added=%d removed=%d merged=%d', bookId, added, removed, merged);
```

---

## 实施检查清单

### 迭代 1 检查清单

- [ ] `uploadSessions` 表已创建并迁移
- [ ] 分片上传逻辑已实现并通过单元测试
- [ ] 断点续传逻辑已实现（刷新页面可恢复）
- [ ] 原子上传逻辑已实现（临时目录 + commit/rollback）
- [ ] `baseCloudStorageConnector.ts` 的 `private` → `protected` 修改
- [ ] `s3Connector.ts` 的 `syncSingleBookProgress` 已实现
- [ ] `s3Connector.ts` 的 `syncSingleBookBookmarks` 已实现
- [ ] `bookSyncService.ts` 已调用进度/书签同步
- [ ] 所有集成测试通过
- [ ] 无 TypeScript 编译错误
- [ ] ESLint 检查通过

### 迭代 2 检查清单

- [ ] `crypto.ts` 工具函数已实现
- [ ] 凭证加密存储已实现
- [ ] 主密码输入 UI 已添加
- [ ] Web Worker 哈希计算已实现
- [ ] 重试策略已应用
- [ ] 上传进度回调已实现
- [ ] 所有集成测试通过

### 迭代 3 检查清单

- [ ] 元数据变更检测已实现
- [ ] 跨连接器去重已实现
- [ ] 连接测试按钮已添加
- [ ] 下载后自动同步已实现

### 迭代 4 检查清单

- [ ] Checksum 复用已实现
- [ ] syncStatus 更新已修复
- [ ] 并发控制已实现
- [ ] P3 全部修复
