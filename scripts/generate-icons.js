import sharp from 'sharp';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];
const publicDir = join(__dirname, '..', 'public');
const assetsDir = join(__dirname, '..', 'src', 'assets');

async function generateIcons() {
  const logoBuffer = readFileSync(join(assetsDir, 'logo.png'));
  
  console.log('Generating PWA icons...');
  
  for (const size of sizes) {
    const outputPath = join(publicDir, `icon-${size}x${size}.png`);
    
    await sharp(logoBuffer)
      .resize(size, size)
      .png()
      .toFile(outputPath);
    
    console.log(`✓ Generated icon-${size}x${size}.png`);
  }
  
  // Generate favicon (32x32)
  await sharp(logoBuffer)
    .resize(32, 32)
    .png()
    .toFile(join(publicDir, 'favicon.png'));
  
  console.log('✓ Generated favicon.png');
  
  // Generate apple touch icon (180x180)
  await sharp(logoBuffer)
    .resize(180, 180)
    .png()
    .toFile(join(publicDir, 'apple-touch-icon.png'));
  
  console.log('✓ Generated apple-touch-icon.png');
  
  console.log('\nAll icons generated successfully!');
}

generateIcons().catch(err => {
  console.error('Error generating icons:', err);
  process.exit(1);
});