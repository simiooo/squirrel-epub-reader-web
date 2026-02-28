import React, { useState, useMemo } from 'react';
import { Tree, Empty } from 'antd';
import { FileTextOutlined, ReadOutlined } from '@ant-design/icons';
import type { Chapter } from '../types';

interface TableOfContentsProps {
  chapters: Chapter[];
  currentChapterId?: string;
  onSelect: (chapterId: string, anchor?: string) => void;
}

interface TreeNode {
  title: React.ReactNode;
  key: string;
  icon?: React.ReactNode;
  children?: TreeNode[];
  chapter: Chapter;
  isCurrent?: boolean;
}

export const TableOfContents: React.FC<TableOfContentsProps> = ({
  chapters,
  currentChapterId,
  onSelect,
}) => {
  // State for manually controlled expanded keys
  const [userExpandedKeys, setUserExpandedKeys] = useState<Set<string>>(new Set());

  // Convert chapters to tree data
  const treeData = useMemo(() => {
    const convertToTreeData = (chapters: Chapter[]): TreeNode[] => {
      return chapters.map((chapter) => {
        const isCurrent = chapter.id === currentChapterId;

        return {
          title: (
            <span
              style={{
                fontWeight: isCurrent ? 600 : 400,
                color: isCurrent ? '#1890ff' : 'inherit',
              }}
            >
              {isCurrent && <ReadOutlined style={{ marginRight: 4 }} />}
              {chapter.title}
            </span>
          ),
          key: chapter.id,
          icon: <FileTextOutlined style={{ color: isCurrent ? '#1890ff' : undefined }} />,
          children: chapter.children ? convertToTreeData(chapter.children) : undefined,
          chapter,
          isCurrent,
        };
      });
    };

    return convertToTreeData(chapters);
  }, [chapters, currentChapterId]);

  // Calculate keys that should be expanded to show current chapter
  const autoExpandedKeys = useMemo(() => {
    const getExpandedKeys = (chapters: Chapter[]): string[] => {
      const keys: string[] = [];

      chapters.forEach((chapter) => {
        // Check if this chapter or any of its children is current
        const isCurrentOrHasCurrent =
          chapter.id === currentChapterId ||
          chapter.children?.some(child =>
            child.id === currentChapterId ||
            child.children?.some(grandchild => grandchild.id === currentChapterId)
          );

        if (isCurrentOrHasCurrent && chapter.children && chapter.children.length > 0) {
          keys.push(chapter.id);
          keys.push(...getExpandedKeys(chapter.children));
        }
      });

      return keys;
    };

    return currentChapterId ? getExpandedKeys(chapters) : [];
  }, [chapters, currentChapterId]);

  // Merge auto-expanded keys with user-expanded keys
  const expandedKeys = useMemo(() => {
    return Array.from(new Set([...autoExpandedKeys, ...userExpandedKeys]));
  }, [autoExpandedKeys, userExpandedKeys]);

  const handleSelect = (selectedKeys: React.Key[], info: { node: TreeNode }) => {
    if (selectedKeys.length > 0) {
      // Extract anchor from href if present
      const href = info.node.chapter.href;
      const anchor = href.includes('#') ? href.split('#')[1] : undefined;
      onSelect(info.node.chapter.id, anchor);
    }
  };

  const handleExpand = (keys: React.Key[]) => {
    setUserExpandedKeys(new Set(keys as string[]));
  };

  if (chapters.length === 0) {
    return (
      <Empty
        description="暂无目录"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        style={{ padding: '20px 0' }}
      />
    );
  }

  return (
    <Tree
      treeData={treeData}
      expandedKeys={expandedKeys}
      selectedKeys={currentChapterId ? [currentChapterId] : []}
      onSelect={handleSelect}
      onExpand={handleExpand}
      style={{
        padding: '8px 0',
      }}
      blockNode
      showLine={{ showLeafIcon: false }}
    />
  );
};
