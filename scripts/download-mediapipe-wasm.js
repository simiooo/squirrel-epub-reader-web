#!/usr/bin/env node
/**
 * Download MediaPipe WASM runtime for offline/fallback use
 * This script downloads the WASM files from jsDelivr CDN to the public directory
 * so they can be served locally when the CDN is not accessible.
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// WASM version (should match package.json version)
const WASM_VERSION = '0.10.32';

// WASM files to download
const WASM_FILES = [
  {
    url: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${WASM_VERSION}/wasm/vision_wasm_internal.wasm`,
    filename: 'vision_wasm_internal.wasm'
  },
  {
    url: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${WASM_VERSION}/wasm/vision_wasm_internal.js`,
    filename: 'vision_wasm_internal.js'
  }
];

// Target directory
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const WASM_DIR = path.join(PUBLIC_DIR, 'wasm');

// Check if file already exists
function fileExists(filePath) {
  return fs.existsSync(filePath);
}

// Ensure directory exists
function ensureDirectory() {
  if (!fs.existsSync(PUBLIC_DIR)) {
    console.log(`Creating public directory: ${PUBLIC_DIR}`);
    fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  }
  if (!fs.existsSync(WASM_DIR)) {
    console.log(`Creating wasm directory: ${WASM_DIR}`);
    fs.mkdirSync(WASM_DIR, { recursive: true });
  }
}

// Download file with progress
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    
    console.log(`\nDownloading: ${path.basename(dest)}`);
    console.log(`From: ${url}`);
    console.log(`To: ${dest}`);
    
    https.get(url, { timeout: 60000 }, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        console.log(`Following redirect to: ${redirectUrl}`);
        file.close();
        if (fs.existsSync(dest)) {
          fs.unlinkSync(dest);
        }
        downloadFile(redirectUrl, dest).then(resolve).catch(reject);
        return;
      }
      
      if (response.statusCode !== 200) {
        file.close();
        if (fs.existsSync(dest)) {
          fs.unlinkSync(dest);
        }
        reject(new Error(`Download failed with status code: ${response.statusCode}`));
        return;
      }
      
      const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
      let downloadedBytes = 0;
      let lastProgress = -1;
      
      response.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (totalBytes > 0) {
          const progress = Math.round((downloadedBytes / totalBytes) * 100);
          if (progress !== lastProgress && progress % 20 === 0) {
            console.log(`  Progress: ${progress}%`);
            lastProgress = progress;
          }
        }
      });
      
      response.pipe(file);
      
      file.on('finish', () => {
        file.close(() => {
          const stats = fs.statSync(dest);
          const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
          console.log(`  ✓ Complete (${sizeMB} MB)`);
          resolve();
        });
      });
      
      file.on('error', (err) => {
        file.close();
        if (fs.existsSync(dest)) {
          fs.unlinkSync(dest);
        }
        reject(err);
      });
    }).on('error', (err) => {
      file.close();
      if (fs.existsSync(dest)) {
        fs.unlinkSync(dest);
      }
      reject(err);
    });
  });
}

// Main function
async function main() {
  console.log('=== MediaPipe WASM Downloader ===');
  console.log(`Version: ${WASM_VERSION}\n`);
  
  let successCount = 0;
  let skipCount = 0;
  let failCount = 0;
  
  try {
    ensureDirectory();
    
    for (const { url, filename } of WASM_FILES) {
      const filePath = path.join(WASM_DIR, filename);
      
      if (fileExists(filePath)) {
        const stats = fs.statSync(filePath);
        const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
        console.log(`\n✓ ${filename} already exists (${sizeMB} MB)`);
        skipCount++;
        continue;
      }
      
      try {
        await downloadFile(url, filePath);
        successCount++;
      } catch (error) {
        console.error(`  ✗ Failed: ${error.message}`);
        failCount++;
      }
    }
    
    console.log('\n' + '='.repeat(50));
    console.log('Download Summary:');
    console.log(`  Downloaded: ${successCount}`);
    console.log(`  Skipped: ${skipCount}`);
    console.log(`  Failed: ${failCount}`);
    
    if (failCount === 0) {
      console.log('\n✅ All WASM files ready!');
      console.log(`Location: ${WASM_DIR}`);
      console.log('\nWASM files will be available at: /wasm/');
      process.exit(0);
    } else {
      console.error('\n⚠️  Some files failed to download');
      console.error('\nPossible solutions:');
      console.error('1. Check your internet connection');
      console.error('2. Try using a VPN if accessing from China');
      console.error('3. Manually download the files from jsDelivr');
      process.exit(1);
    }
  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    process.exit(1);
  }
}

main();
