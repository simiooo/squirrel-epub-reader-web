/**
 * EPUB Table Parser Test Script
 * 
 * Run with: npx tsx scripts/test-epub-tables.ts
 */

import { epubParser } from '../src/utils/epubParser';
import * as fs from 'fs';
import * as path from 'path';

async function analyzeEpub(filePath: string): Promise<void> {
  console.log(`\n========================================`);
  console.log(`Analyzing: ${path.basename(filePath)}`);
  console.log(`========================================\n`);

  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    return;
  }

  const fileBuffer = fs.readFileSync(filePath);
  const blob = new Blob([fileBuffer]);

  try {
    // Load EPUB
    const result = await epubParser.load(blob);
    
    console.log(`📚 Book: ${result.metadata.title}`);
    console.log(`✍️  Author: ${result.metadata.author}`);
    console.log(`📑 Total Chapters: ${result.chapters.length}`);
    console.log(`📋 TOC Items: ${result.tableOfContents.length}\n`);

    // Analyze each chapter for tables
    let totalTables = 0;
    let chaptersWithTables = 0;

    result.chapters.forEach((chapter, index) => {
      const parser = new DOMParser();
      const doc = parser.parseFromString(chapter.content, 'text/html');
      const tables = doc.querySelectorAll('table');
      
      if (tables.length > 0) {
        chaptersWithTables++;
        totalTables += tables.length;
        console.log(`\n📄 Chapter ${index + 1}: "${chapter.title}"`);
        console.log(`   Found ${tables.length} table(s)`);
        
        tables.forEach((table, tableIndex) => {
          const rows = table.querySelectorAll('tr').length;
          const captionEl = table.querySelector('caption');
          const caption = captionEl?.textContent?.substring(0, 50) || 'No caption';
          console.log(`   ├─ Table ${tableIndex + 1}: ${rows} rows, caption: "${caption}..."`);
          
          // Check if table is wrapped in special elements
          let parent = table.parentElement;
          const wrapPath: string[] = [];
          while (parent && parent.tagName !== 'BODY') {
            wrapPath.push(parent.tagName.toLowerCase());
            parent = parent.parentElement;
          }
          if (wrapPath.length > 0) {
            console.log(`   │  └─ Wrapped in: ${wrapPath.join(' > ')}`);
          }
        });
      }
    });

    console.log(`\n========================================`);
    console.log(`📊 Summary:`);
    console.log(`   Total tables found: ${totalTables}`);
    console.log(`   Chapters with tables: ${chaptersWithTables}/${result.chapters.length}`);
    console.log(`========================================\n`);

    // Check for specific Table 2.1
    console.log('🔍 Searching for "Table 2.1"...');
    result.chapters.forEach((chapter, index) => {
      if (chapter.content.includes('Table 2.1') || 
          chapter.content.includes('Table&nbsp;2.1') ||
          chapter.content.includes('filepos134040')) {
        console.log(`   ✅ Found reference in Chapter ${index + 1}: "${chapter.title}"`);
        
        // Extract context around the reference
        const content = chapter.content;
        const matchIndex = content.indexOf('Table 2.1');
        if (matchIndex !== -1) {
          const start = Math.max(0, matchIndex - 100);
          const end = Math.min(content.length, matchIndex + 300);
          const context = content.substring(start, end);
          console.log(`   Context: ...${context.replace(/\n/g, ' ')}...\n`);
        }
      }
    });

  } catch (error) {
    console.error(`❌ Error parsing EPUB:`, error);
  }
}

// Main execution
const epubFile = process.argv[2] || 'Linux Kernel Development (Robert Love) (z-library.sk, 1lib.sk, z-lib.sk).epub';
const filePath = path.join(process.cwd(), epubFile);

analyzeEpub(filePath).catch(console.error);
