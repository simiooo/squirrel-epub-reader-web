/**
 * EPUB Content Analyzer Script
 * 
 * Run with: npx tsx scripts/analyze-epub.ts
 */

import JSZip from 'jszip';
import * as fs from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';

async function analyzeEpub(filePath: string): Promise<void> {
  console.log(`\n========================================`);
  console.log(`Analyzing: ${path.basename(filePath)}`);
  console.log(`========================================\n`);

  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    return;
  }

  const fileBuffer = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(fileBuffer);

  // Find OPF file
  const containerFile = zip.file('META-INF/container.xml');
  if (!containerFile) {
    console.error('❌ Invalid EPUB: container.xml not found');
    return;
  }

  const containerContent = await containerFile.async('text');
  const containerParser = new JSDOM(containerContent, { contentType: 'application/xml' });
  const containerDoc = containerParser.window.document;
  const rootfile = containerDoc.querySelector('rootfile[media-type="application/oebps-package+xml"]');
  
  if (!rootfile) {
    console.error('❌ Invalid EPUB: rootfile not found');
    return;
  }

  const opfPath = rootfile.getAttribute('full-path') || '';
  const basePath = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';

  const opfFile = zip.file(opfPath);
  if (!opfFile) {
    console.error('❌ OPF file not found');
    return;
  }

  const opfContent = await opfFile.async('text');
  const opfParser = new JSDOM(opfContent, { contentType: 'application/xml' });
  const opfDoc = opfParser.window.document;

  // Get spine items
  const spineItems = opfDoc.querySelectorAll('spine itemref');
  const manifest: Map<string, string> = new Map();
  
  opfDoc.querySelectorAll('manifest item').forEach(item => {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (id && href) {
      manifest.set(id, href);
    }
  });

  console.log(`📑 Total chapters in spine: ${spineItems.length}\n`);

  let totalTables = 0;
  let table2_1Found = false;

  for (let i = 0; i < spineItems.length; i++) {
    const idref = spineItems[i].getAttribute('idref');
    if (!idref) continue;

    const href = manifest.get(idref);
    if (!href) continue;

    const chapterPath = basePath + href;
    const chapterFile = zip.file(chapterPath);
    if (!chapterFile) continue;

    const content = await chapterFile.async('text');
    
    // Check for Table 2.1
    if (content.includes('Table 2.1') || 
        content.includes('Table&nbsp;2.1') ||
        content.includes('Directories in the Root') ||
        content.includes('filepos134040')) {
      console.log(`🔍 Chapter ${i + 1} (${href}) contains Table 2.1 reference`);
      table2_1Found = true;
      
      // Parse and show context
      const chapterParser = new JSDOM(content, { contentType: 'application/xhtml+xml' });
      const chapterDoc = chapterParser.window.document;
      const body = chapterDoc.querySelector('body');
      
      if (body) {
        const tables = body.querySelectorAll('table');
        console.log(`   Found ${tables.length} table(s) in this chapter`);
        
        // Search for Table 2.1 context
        const htmlContent = body.innerHTML;
        const table2_1Index = htmlContent.indexOf('Table 2.1');
        
        if (table2_1Index !== -1) {
          // Extract 1000 characters around the reference
          const start = Math.max(0, table2_1Index - 500);
          const end = Math.min(htmlContent.length, table2_1Index + 500);
          const context = htmlContent.substring(start, end);
          
          console.log(`\n   📄 Context around "Table 2.1":`);
          console.log(`   ${'-'.repeat(80)}`);
          console.log(context);
          console.log(`   ${'-'.repeat(80)}\n`);
        }
        
        // Also check if there are any images that might be the table
        const images = body.querySelectorAll('img, svg');
        if (images.length > 0) {
          console.log(`   🖼️  Found ${images.length} image(s)/SVG(s) in this chapter`);
        }
        
        tables.forEach((table, idx) => {
          const text = table.textContent || '';
          if (text.includes('Table 2.1') || text.includes('Directories')) {
            console.log(`\n   📊 TABLE ${idx + 1} (This appears to be Table 2.1):`);
            console.log(`   ${'-'.repeat(60)}`);
            
            const rows = table.querySelectorAll('tr');
            console.log(`   Rows: ${rows.length}`);
            
            // Show first few rows
            rows.forEach((row, rowIdx) => {
              if (rowIdx < 5) {
                const cells = row.querySelectorAll('td, th');
                const cellText = Array.from(cells).map((c: Element) => (c as HTMLElement).textContent?.trim()).join(' | ');
                console.log(`   Row ${rowIdx + 1}: ${cellText}`);
              } else if (rowIdx === 5) {
                console.log(`   ... (${rows.length - 5} more rows)`);
              }
            });
            
            console.log(`   ${'-'.repeat(60)}\n`);
            totalTables++;
          } else {
            totalTables++;
          }
        });
      }
    }
  }

  if (!table2_1Found) {
    console.log('❌ Table 2.1 was not found in the EPUB');
    
    // Let's search for any tables
    console.log('\n🔍 Searching for all tables in the EPUB...');
    
    for (let i = 0; i < spineItems.length; i++) {
      const idref = spineItems[i].getAttribute('idref');
      if (!idref) continue;

      const href = manifest.get(idref);
      if (!href) continue;

      const chapterPath = basePath + href;
      const chapterFile = zip.file(chapterPath);
      if (!chapterFile) continue;

      const content = await chapterFile.async('text');
      const chapterParser = new JSDOM(content, { contentType: 'application/xhtml+xml' });
      const chapterDoc = chapterParser.window.document;
      const body = chapterDoc.querySelector('body');
      
      if (body) {
        const tables = body.querySelectorAll('table');
        if (tables.length > 0) {
          console.log(`\n📄 Chapter ${i + 1} (${href}): ${tables.length} table(s)`);
          tables.forEach((table, idx) => {
            const caption = table.querySelector('caption')?.textContent?.substring(0, 50);
            const rows = table.querySelectorAll('tr').length;
            console.log(`   └─ Table ${idx + 1}: ${rows} rows${caption ? `, caption: "${caption}..."` : ''}`);
          });
        }
      }
    }
  }

  console.log(`\n========================================`);
  console.log(`📊 Total tables found: ${totalTables}`);
  console.log(`========================================\n`);
}

// Main execution
const epubFile = process.argv[2] || 'Linux Kernel Development (Robert Love) (z-library.sk, 1lib.sk, z-lib.sk).epub';
const filePath = path.join(process.cwd(), epubFile);

analyzeEpub(filePath).catch(console.error);
