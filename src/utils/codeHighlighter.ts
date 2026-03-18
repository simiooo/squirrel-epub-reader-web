import hljs from 'highlight.js';

/**
 * Recursively extract text content from an element, preserving whitespace and line breaks
 * Ignores HTML tag semantics, only extracts text nodes
 */
function extractTextContent(element: Element): string {
  let text = '';
  
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      // Text node - add content as-is
      text += node.textContent || '';
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      const tagName = el.tagName.toLowerCase();
      
      if (tagName === 'br') {
        // Preserve line breaks
        text += '\n';
      } else {
        // Recursively extract from child elements
        text += extractTextContent(el);
      }
    }
  }
  
  return text;
}

/**
 * Detect programming language from code content
 * Returns the language identifier or null if can't detect
 */
function detectLanguage(code: string): string | null {
  // Common language patterns for detection
  const patterns: { [key: string]: RegExp[] } = {
    cpp: [
      /#include\s*[<"]/,
      /\b(int|void|char|float|double|bool|auto|const|static|extern|inline)\s+\w+\s*\(/,
      /\b(std::|cout|cin|endl|vector|map|set|string)\b/,
      /\b(class|struct|namespace|template|typename|public:|private:|protected:)\b/,
    ],
    c: [
      /#include\s*[<"]/,
      /\b(int|void|char|float|double|const|static|extern|inline|struct|typedef)\s+\w+/,
      /\b(printf|scanf|malloc|free|sizeof|NULL)\b/,
      /\b(int|void|char|float|double)\s*\*\s*\w+\s*\(/,
    ],
    javascript: [
      /\b(const|let|var)\s+\w+\s*[=:]/,
      /\b(function|class|extends|import|export|from|async|await|=>)\b/,
      /\b(console|document|window|require|module|exports)\b/,
      /\b(typeof|instanceof|new|this)\b/,
    ],
    typescript: [
      /:\s*(string|number|boolean|any|void|never|unknown)\b/,
      /\b(interface|type|enum|namespace|declare|abstract|implements)\b/,
      /\b(const|let|var)\s+\w+\s*:\s*\w+/,
    ],
    python: [
      /\b(def|class|import|from|as|if|elif|else|for|while|try|except|finally|with|lambda)\b/,
      /\b(print|len|range|list|dict|set|tuple|str|int|float)\s*\(/,
      /:\s*\n\s+/,
      /#.*$/m,
    ],
    java: [
      /\b(public|private|protected|static|final|abstract|class|interface|extends|implements)\b/,
      /\b(System\.out\.print|println|main\s*\(\s*String)/,
      /\b(int|void|String|boolean|double|float|char|long|short|byte)\s+\w+/,
    ],
    go: [
      /\b(package|import|func|type|struct|interface|var|const|defer|go|chan|range)\b/,
      /\b(fmt\.Print|log\.|os\.|http\.|strings\.)/,
      /:=\s+/,
    ],
    rust: [
      /\b(fn|let|mut|const|struct|enum|impl|trait|match|if|else|loop|while|for|use|mod|pub)\b/,
      /\b(println!|vec!|Some|None|Ok|Err)\b/,
      /&\w+|&mut\s+\w+/,
    ],
    bash: [
      /^#!/,
      /\b(echo|cd|ls|pwd|cat|grep|sed|awk|chmod|chown|mkdir|rmdir|rm|cp|mv)\b/,
      /\$\w+|\$\{[^}]+\}/,
      /\|\s*\w+/,
    ],
    html: [
      /<\/?[a-zA-Z][^>]*>/,
      /\b(html|head|body|div|span|p|a|img|script|style|link|meta)\b/,
    ],
    css: [
      /[.#]\w+\s*\{/,
      /\b(color|background|font|margin|padding|border|display|position|width|height)\s*:/,
      /\b(px|em|rem|%|vh|vw)\b/,
    ],
    sql: [
      /\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|GROUP|ORDER|BY|HAVING|LIMIT)\b/i,
      /\b(CREATE|TABLE|ALTER|DROP|INDEX|PRIMARY|KEY|FOREIGN|REFERENCES)\b/i,
    ],
  };

  // Test patterns in order of confidence
  for (const [lang, regexes] of Object.entries(patterns)) {
    const matchCount = regexes.filter(regex => regex.test(code)).length;
    // If more than half the patterns match, consider it this language
    if (matchCount >= Math.ceil(regexes.length / 2)) {
      return lang;
    }
  }

  // Fallback: try to use highlight.js auto-detection
  try {
    const result = hljs.highlightAuto(code);
    if (result.relevance > 5) {
      return result.language || null;
    }
  } catch {
    // Ignore auto-detection errors
  }

  return null;
}

/**
 * Process code blocks in HTML content
 * Finds tt elements with line breaks and applies syntax highlighting
 */
export function processCodeBlocks(htmlContent: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlContent, 'text/html');
  
  // Find all tt elements that contain line breaks (indicating code blocks)
  const ttElements = doc.querySelectorAll('tt');
  
  ttElements.forEach(tt => {
    // Check if this tt contains line breaks
    const hasLineBreaks = tt.querySelector('br') !== null || 
                          tt.innerHTML.includes('\n') ||
                          tt.textContent?.includes('\n');
    
    if (!hasLineBreaks) {
      return; // Skip inline code
    }
    
    // Extract pure text content recursively
    const codeText = extractTextContent(tt);
    
    // Detect language
    const language = detectLanguage(codeText);
    
    // Apply syntax highlighting
    let highlightedCode: string;
    try {
      if (language && hljs.getLanguage(language)) {
        highlightedCode = hljs.highlight(codeText, { language }).value;
      } else {
        highlightedCode = hljs.highlightAuto(codeText).value;
      }
    } catch {
      // If highlighting fails, escape HTML and use as-is
      highlightedCode = escapeHtml(codeText);
    }
    
    // Create new pre > code structure
    const pre = doc.createElement('pre');
    const code = doc.createElement('code');
    
    if (language) {
      code.className = `hljs language-${language}`;
    } else {
      code.className = 'hljs';
    }
    
    code.innerHTML = highlightedCode;
    pre.appendChild(code);
    
    // Copy any classes from the original tt (excluding calibre classes)
    const originalClasses = Array.from(tt.classList).filter(c => !c.startsWith('calibre'));
    if (originalClasses.length > 0) {
      pre.classList.add(...originalClasses);
    }
    
    // Replace the tt element with the new pre element
    tt.replaceWith(pre);
  });
  
  return doc.body.innerHTML;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Check if content has code blocks that need processing
 */
export function hasCodeBlocks(htmlContent: string): boolean {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlContent, 'text/html');
  const ttElements = doc.querySelectorAll('tt');
  
  return Array.from(ttElements).some(tt => {
    return tt.querySelector('br') !== null || 
           tt.innerHTML.includes('\n') ||
           tt.textContent?.includes('\n');
  });
}