#!/usr/bin/env node
/**
 * Download MediaPipe hand landmarker model for offline/fallback use
 * This script downloads the model file from Google Cloud Storage to the public directory
 * so it can be served locally when the CDN is not accessible.
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Model URLs
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const MODEL_FILE_NAME = 'hand_landmarker.task';

// Target directory
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MODELS_DIR = path.join(PUBLIC_DIR, 'models');
const MODEL_PATH = path.join(MODELS_DIR, MODEL_FILE_NAME);

// Check if model already exists
function modelExists() {
  return fs.existsSync(MODEL_PATH);
}

// Ensure directory exists
function ensureDirectory() {
  if (!fs.existsSync(PUBLIC_DIR)) {
    console.log(`Creating public directory: ${PUBLIC_DIR}`);
    fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  }
  if (!fs.existsSync(MODELS_DIR)) {
    console.log(`Creating models directory: ${MODELS_DIR}`);
    fs.mkdirSync(MODELS_DIR, { recursive: true });
  }
}

// Download file with progress
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    
    console.log(`Downloading from: ${url}`);
    console.log(`Saving to: ${dest}`);
    
    https.get(url, { timeout: 60000 }, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        console.log(`Following redirect to: ${redirectUrl}`);
        file.close();
        fs.unlinkSync(dest);
        downloadFile(redirectUrl, dest).then(resolve).catch(reject);
        return;
      }
      
      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        reject(new Error(`Download failed with status code: ${response.statusCode}`));
        return;
      }
      
      const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
      let downloadedBytes = 0;
      let lastProgress = 0;
      
      response.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (totalBytes > 0) {
          const progress = Math.round((downloadedBytes / totalBytes) * 100);
          if (progress !== lastProgress && progress % 10 === 0) {
            console.log(`Download progress: ${progress}%`);
            lastProgress = progress;
          }
        }
      });
      
      response.pipe(file);
      
      file.on('finish', () => {
        file.close(() => {
          const stats = fs.statSync(dest);
          const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
          console.log(`Download complete! File size: ${sizeMB} MB`);
          resolve();
        });
      });
      
      file.on('error', (err) => {
        file.close();
        fs.unlinkSync(dest);
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
  console.log('=== MediaPipe Model Downloader ===\n');
  
  try {
    if (modelExists()) {
      const stats = fs.statSync(MODEL_PATH);
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
      console.log(`Model file already exists at: ${MODEL_PATH}`);
      console.log(`File size: ${sizeMB} MB`);
      console.log('Skipping download.\n');
      process.exit(0);
    }
    
    ensureDirectory();
    await downloadFile(MODEL_URL, MODEL_PATH);
    
    console.log('\n✅ Model downloaded successfully!');
    console.log(`Location: ${MODEL_PATH}`);
    console.log('\nThe model will be available at: /models/hand_landmarker.task');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Download failed:', error.message);
    
    if (fs.existsSync(MODEL_PATH)) {
      fs.unlinkSync(MODEL_PATH);
    }
    
    console.error('\nPossible solutions:');
    console.error('1. Check your internet connection');
    console.error('2. Try using a VPN or proxy if accessing from China');
    console.error('3. Manually download the file from:');
    console.error(`   ${MODEL_URL}`);
    console.error(`   And place it at: ${MODEL_PATH}`);
    
    process.exit(1);
  }
}

main();
