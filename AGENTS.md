# Agent Development Guidelines

This document provides guidelines for AI agents working on the Squirrel EPUB Reader codebase.

## Package Manager

**Always use pnpm** for package management. Do not use npm or yarn.

```bash
pnpm install         # Install dependencies
pnpm add <package>   # Add a dependency
pnpm dev             # Development server
pnpm build           # Build for production
pnpm lint            # Lint code
pnpm preview         # Preview production build
pnpm generate-icons  # Generate PWA icons
```

## TypeScript Configuration
- **Target**: ES2022 with strict mode enabled
- **Module**: ESNext with bundler resolution
- **JSX**: react-jsx transform
- All strict flags enabled: `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`

## Naming Conventions
- **Components**: PascalCase (e.g., `BookReader`, `TableOfContents`)
- **Interfaces/Types**: PascalCase (e.g., `BookMetadata`, `ReadingProgress`)
- **Functions/Variables**: camelCase (e.g., `parseEpub`, `currentChapter`)
- **Constants**: UPPER_SNAKE_CASE
- **CSS Classes**: kebab-case (e.g., `chapter-content`)

## Import Patterns
```typescript
// React imports first
import React, { useState, useEffect } from 'react';

// Third-party libraries
import { useTranslation } from 'react-i18next';
import { Button, Layout } from 'antd';

// Absolute imports from project
import { epubParser } from '../utils/epubParser';
import { saveProgress } from '../db';

// Type imports
import type { Book, Chapter } from '../types';

// CSS imports last
import './App.css';
```

## Component Structure
```typescript
interface ComponentProps {
  book: Book;
  onClose: () => void;
}

export const Component: React.FC<ComponentProps> = ({ book, onClose }) => {
  // Hooks at the top
  const { t } = useTranslation();
  const [state, setState] = useState(initialValue);
  
  // Effects
  useEffect(() => {
    // implementation
  }, [dependencies]);
  
  // Event handlers
  const handleClick = useCallback(() => {
    // implementation
  }, [dependencies]);
  
  return (
    // JSX
  );
};
```

## EPUB Content Styling Standards

### Font Strategy
- **Chinese**: MiSans (unified, no serif/sans-serif distinction)
  - CDN: `https://cdn.jsdelivr.net/npm/misans-webfont/misans-style.css`
- **Western Headings**: Nunito (rounded, friendly)
  - CDN: `https://fonts.bunny.net/css2?family=Nunito:wght@400;500;600;700&display=swap`
- **Western Body**: Merriweather (rounded serif)
  - CDN: `https://fonts.bunny.net/css2?family=Merriweather:wght@400;500;600;700&display=swap`

### CSS Variable Usage
Always use Ant Design CSS variables with fallbacks:
```css
/* Font sizes */
font-size: var(--antd-font-size-lg, 16px);     /* Body: 16px */
font-size: var(--antd-font-size, 14px);        /* Default: 14px */
font-size: var(--antd-font-size-sm, 12px);     /* Small: 12px */

/* Line heights */
line-height: var(--antd-line-height, 1.57);    /* Default */
line-height: var(--antd-line-height-lg, 1.5);  /* Large text */
line-height: var(--antd-line-height-sm, 1.67); /* Small text */

/* Spacing */
margin: var(--antd-margin, 16px);
padding: var(--antd-padding-sm, 12px);

/* Colors */
color: var(--antd-color-text);
background: var(--antd-color-bg-container);
```

### Typography Scale
```css
/* Headings - all based on antd-font-size-lg (16px) */
h1: calc(var(--antd-font-size-lg) * 2)      /* 32px */
h2: calc(var(--antd-font-size-lg) * 1.75)   /* 28px */
h3: calc(var(--antd-font-size-lg) * 1.5)    /* 24px */
h4: calc(var(--antd-font-size-lg) * 1.25)   /* 20px */
h5: var(--antd-font-size-lg)                /* 16px */
h6: var(--antd-font-size)                   /* 14px */

/* Special elements */
code: calc(var(--antd-font-size) * 0.875)   /* 87.5% */
sup: calc(var(--antd-font-size) * 0.75)     /* 75% */
```

## Error Handling

### Try-Catch Patterns
```typescript
try {
  const result = await parseEpub(file);
  setChapters(result.chapters);
} catch (error) {
  message.error(t('parseError'));
  console.error('EPUB parsing failed:', error);
}
```

### Type Safety
- Always define explicit return types for functions
- Use `type` imports when importing only types
- Avoid `any` - use `unknown` with type guards when necessary

## ESLint Rules

Key enforced rules:
- `@typescript-eslint/recommended`
- `react-hooks/exhaustive-deps`
- `react-refresh/only-export-components`
- No unused variables or parameters
- No fallthrough in switch cases

## Database Operations

Use Dexie for IndexedDB operations:
```typescript
import { db } from '../db';

// Save with error handling
try {
  await db.books.add(book);
} catch (error) {
  message.error(t('saveError'));
}
```

## Internationalization

Always use `t()` function from react-i18next:
```typescript
const { t } = useTranslation();

// In JSX
<Button>{t('button.read')}</Button>
```

## Performance Guidelines

1. Use `useCallback` for event handlers passed to children
2. Use `useMemo` for expensive computations
3. Lazy load heavy components with `React.lazy()`
4. Fonts load asynchronously - use system fonts as fallback

## File Organization

```
src/
├── components/        # Reusable React components
├── pages/            # Route-level page components
├── utils/            # Utility functions
├── db/               # Database operations
├── types/            # TypeScript interfaces
├── i18n/             # Internationalization config
├── routes/           # Route definitions
├── App.tsx           # Root component
├── App.css           # EPUB content styles
└── main.tsx          # Entry point
```

## Critical Notes

1. **Never use fixed pixel values** - Always use antd CSS variables
2. **Always provide fallbacks** - Every `var()` must have a default value
3. **Chinese font consistency** - Always use MiSans, no serif/sans-serif distinction
4. **Async font loading** - Never block rendering for fonts
5. **Clean empty elements** - Remove `&nbsp;` only block elements during EPUB parsing
