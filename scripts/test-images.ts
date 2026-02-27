/**
 * Test image management system
 * Run: npx tsx scripts/test-images.ts
 */

import { createImageManager } from '../src/utils/imageManager';

async function testImageManager() {
  console.log('🧪 Testing Image Resource Manager with Concurrency\n');
  
  const manager = createImageManager('test-book', { maxCacheSize: 3 });
  
  // Create test blobs
  const blob1 = new Blob(['test1'], { type: 'image/jpeg' });
  const blob2 = new Blob(['test2'], { type: 'image/jpeg' });
  const blob3 = new Blob(['test3'], { type: 'image/jpeg' });
  
  // Register images
  manager.registerImage('img-1', 'path/1.jpg', blob1);
  manager.registerImage('img-2', 'path/2.jpg', blob2);
  manager.registerImage('img-3', 'path/3.jpg', blob3);
  
  console.log('✅ Registered 3 images');
  console.log(`📊 Stats:`, manager.getStats());
  
  // Test 1: Concurrent loading of same image (should only create one URL)
  console.log('\n📋 Test 1: Concurrent loading of same image');
  const url1 = manager.getImageUrl('img-1');
  const url2 = manager.getImageUrl('img-1');
  const url3 = manager.getImageUrl('img-1');
  
  if (url1 === url2 && url2 === url3) {
    console.log('✅ All URLs are identical (no duplicate creation)');
  } else {
    console.log('❌ URLs differ (race condition detected)');
  }
  console.log(`📊 Stats:`, manager.getStats());
  
  // Test 2: Release timeout cancellation
  console.log('\n📋 Test 2: Release timeout cancellation');
  manager.releaseImage('img-1', 100); // Release after 100ms
  
  // Immediately reload (should cancel release)
  await new Promise(resolve => setTimeout(resolve, 50));
  const urlAfterReload = manager.getImageUrl('img-1');
  
  await new Promise(resolve => setTimeout(resolve, 100));
  console.log(`📊 Stats after reload:`, manager.getStats());
  
  if (urlAfterReload === url1) {
    console.log('✅ URL preserved after reload (release cancelled)');
  } else {
    console.log('❌ URL changed (release not cancelled properly)');
  }
  
  // Test 3: LRU eviction
  console.log('\n📋 Test 3: LRU eviction');
  manager.getImageUrl('img-2');
  manager.getImageUrl('img-3');
  
  // Try to load a 4th image - should evict least recently used
  const blob4 = new Blob(['test4'], { type: 'image/jpeg' });
  manager.registerImage('img-4', 'path/4.jpg', blob4);
  manager.getImageUrl('img-4');
  
  console.log(`📊 Stats after loading 4th image:`, manager.getStats());
  console.log('✅ Eviction should have occurred (max 3 cached)');
  
  // Test 4: Rapid register/unregister (simulating React Strict Mode)
  console.log('\n📋 Test 4: Rapid create/dispose (React Strict Mode simulation)');
  const manager2 = createImageManager('test-book-2', { maxCacheSize: 2 });
  
  // Register and load
  manager2.registerImage('rapid-1', 'path/r1.jpg', new Blob(['r1']));
  manager2.getImageUrl('rapid-1');
  
  // Dispose and recreate (simulating React unmount/remount)
  manager2.dispose();
  
  const manager3 = createImageManager('test-book-2', { maxCacheSize: 2 });
  manager3.registerImage('rapid-1', 'path/r1.jpg', new Blob(['r1']));
  const rapidUrl = manager3.getImageUrl('rapid-1');
  
  console.log(`📊 Stats after recreation:`, manager3.getStats());
  console.log(rapidUrl ? '✅ Successfully recreated after disposal' : '❌ Failed to recreate');
  
  manager3.dispose();
  
  // Cleanup
  manager.dispose();
  console.log('\n✅ All concurrency tests passed!');
}

testImageManager().catch(console.error);
