import React from 'react';
import { Tree, Empty } from 'antd';
import { FileTextOutlined, ReadOutlined } from '@ant-design/icons';
import type { Chapter } from '../types';

interface TableOfContentsProps {
  chapters: Chapter[];
  currentChapterId?: string;
  onSelect: (chapterId: string) => void;
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

  const treeData = convertToTreeData(chapters);

  const handleSelect = (selectedKeys: React.Key[], info: { node: TreeNode }) => {
    if (selectedKeys.length > 0) {
      onSelect(info.node.chapter.id);
    }
  };

  // Auto expand to show current chapter
  const getExpandedKeys = (chapters: Chapter[], parentId: string = ''): string[] => {
    const keys: string[] = [];
    
    chapters.forEach((chapter) => {
      const fullId = parentId ? `${parentId}-${chapter.id}` : chapter.id;
      
      // Check if this chapter or any of its children is current
      const isCurrentOrHasCurrent = 
        chapter.id === currentChapterId ||
        chapter.children?.some(child => 
          child.id === currentChapterId || 
          child.children?.some(grandchild => grandchild.id === currentChapterId)
        );
      
      if (isCurrentOrHasCurrent && chapter.children && chapter.children.length > 0) {
        keys.push(chapter.id);
        keys.push(...getExpandedKeys(chapter.children, fullId));
      }
    });
    
    return keys;
  };

  const expandedKeys = getExpandedKeys(chapters);

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
      defaultExpandAll
      expandedKeys={expandedKeys}
      selectedKeys={currentChapterId ? [currentChapterId] : []}
      onSelect={handleSelect}
      style={{
        padding: '8px 0',
      }}
      blockNode
      showLine={{ showLeafIcon: false }}
    />
  );
};
