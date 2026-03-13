# Squirrel EPUB Reader

A beautiful and feature-rich EPUB reader application with cloud storage synchronization support.

## Features

- 📚 **EPUB Reading**: Support for EPUB format e-books
- ☁️ **Cloud Sync**: Synchronize books, reading progress, and bookmarks across devices
- 📱 **Responsive Design**: Works on desktop and mobile devices
- 🌐 **Multi-language**: Internationalization support
- 🔖 **Bookmarks**: Save and manage bookmarks
- 📊 **Reading Progress**: Track reading progress across sessions
- 🎨 **Beautiful UI**: Modern interface with dark/light mode support

## Cloud Storage Support

Squirrel Reader supports multiple cloud storage providers via S3-compatible APIs:

### Supported Providers

- **AWS S3**
- **Cloudflare R2**
- **Backblaze B2**
- **Alibaba Cloud OSS**
- **Tencent Cloud COS**
- **MinIO**
- Any other S3-compatible storage service

### Cloud Storage Configuration

#### General S3-Compatible Storage

| Setting | Description | Example |
|---------|-------------|---------|
| **Endpoint** | S3 service endpoint URL | `https://s3.us-west-2.amazonaws.com` |
| **Bucket** | Storage bucket name | `my-books` |
| **Region** | Service region (optional) | `us-west-2` |
| **Access Key ID** | Your access key | `AKIA...` |
| **Secret Access Key** | Your secret key | `...` |
| **Force Path-Style** | Use path-style URLs (see below) | Depends on provider |
| **Root Path** | Base directory for app data | `/SquirrelReader` |

#### Provider-Specific Guidelines

**Cloudflare R2**

```
Endpoint: https://<account-id>.r2.cloudflarestorage.com
Bucket: <your-bucket-name>
Region: auto (or leave empty)
Access Key ID: <your-access-key>
Secret Access Key: <your-secret-key>
Force Path-Style: ✅ Recommended (to avoid CORS issues)
```

**Backblaze B2**

```
Endpoint: https://s3.<region>.backblazeb2.com
Bucket: <your-bucket-name>
Region: <region> (e.g., us-west-004)
Access Key ID: <your-key-id>
Secret Access Key: <your-application-key>
Force Path-Style: ✅ Required
```

**AWS S3**

```
Endpoint: https://s3.<region>.amazonaws.com
Bucket: <your-bucket-name>
Region: <region> (e.g., us-east-1)
Access Key ID: <your-access-key>
Secret Access Key: <your-secret-key>
Force Path-Style: ❌ Not needed
```

### CORS Configuration

#### Backblaze B2

If you encounter CORS errors with Backblaze B2, configure CORS in your bucket settings:

1. Log in to Backblaze B2 Console
2. Go to your bucket → **Bucket Settings**
3. Add CORS Rule:
   - **Allowed Origins**: `http://localhost:5173` (for development)
   - **Allowed Methods**: `GET`, `PUT`, `POST`, `DELETE`, `HEAD`
   - **Allowed Headers**: `authorization`, `x-amz-date`, `x-amz-content-sha256`, `content-type`
   - **Max Age**: `3600`

#### Cloudflare R2

Cloudflare R2 typically works without additional CORS configuration. If you encounter issues:

1. Use **Path-Style URLs** (enable "Force Path-Style")
2. Or configure CORS in R2 bucket settings (if needed)

#### AWS S3

Configure CORS via AWS Console or CLI:

```json
{
  "CORSRules": [
    {
      "AllowedOrigins": ["http://localhost:5173"],
      "AllowedMethods": ["GET", "PUT", "POST", "DELETE", "HEAD"],
      "AllowedHeaders": ["*"],
      "MaxAgeSeconds": 3600
    }
  ]
}
```

### Troubleshooting

**CORS Errors**

1. Enable "Force Path-Style URL" option
2. Check CORS configuration on your storage provider
3. Clear browser cache and retry
4. For development, use path-style URLs to avoid subdomain CORS issues

**Connection Failed**

1. Verify endpoint URL format
2. Check Access Key and Secret Key
3. Ensure bucket exists and is accessible
4. Verify the key has read/write permissions for the bucket

**Region Auto-Detection**

The app automatically detects region from the endpoint URL:
- `s3.us-west-2.amazonaws.com` → `us-west-2`
- `s3.us-west-004.backblazeb2.com` → `us-west-004`
- `xxx.r2.cloudflarestorage.com` → `auto`

You can override this by manually entering the region.

## Development

### Prerequisites

- Node.js 18+
- pnpm

### Setup

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Build for production
pnpm build

# Run linter
pnpm lint
```

### Project Structure

```
src/
├── components/          # React components
│   ├── cloud/          # Cloud storage components
│   └── ...
├── services/           # Business logic
│   ├── connectors/     # Cloud storage connectors
│   └── ...
├── db/                 # Database (IndexedDB)
├── types/              # TypeScript types
└── ...
```

## Tech Stack

- **Framework**: React + TypeScript + Vite
- **UI Library**: Ant Design
- **State Management**: React Context + Hooks
- **Storage**: IndexedDB (local) + S3-compatible (cloud)
- **Internationalization**: i18next
- **Build**: Rolldown (Vite 6+)

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Acknowledgments

- Built with [Vite](https://vitejs.dev/)
- UI components from [Ant Design](https://ant.design/)
- EPUB parsing with [epub.js](https://github.com/futurepress/epub.js/)
