import { useState, useCallback, useMemo } from 'react';
import { css } from '@linaria/core';
import { Tree } from 'haze-ui';

type SourceFile = {
  filename: string;
  content: string;
};

type SourceCodeViewerProps = {
  sourceCode: string;
  sourceFiles?: SourceFile[];
};

type TreeNode = {
  key: string;
  title: string;
  isLeaf?: boolean;
  content?: string;
  children?: TreeNode[];
};

const containerStyles = css`
  position: relative;
  border: 1px solid #e1e5e9;
  border-radius: 6px;
  overflow: hidden;
`;

const layoutStyles = css`
  display: flex;
  min-height: 400px;
  width: 100%;
  overflow: hidden;
`;

const treeContainerStyles = css`
  width: 260px;
  min-width: 200px;
  max-width: 260px;
  border-right: 1px solid #e1e5e9;
  background: #fafbfc;
  overflow-y: auto;
  padding: 8px;
  flex-shrink: 0;
`;

const treeWrapperStyles = css`
  overflow-x: hidden;
`;

const codeAreaStyles = css`
  flex: 1;
  min-width: 0;
  position: relative;
  overflow: hidden;
`;

const codeContainerStyles = css`
  position: relative;
`;

const codeBlockStyles = css`
  background: #f8f9fa;
  padding: 16px;
  overflow-x: auto;
  font-family:
    'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.4;
  white-space: pre-wrap;
  max-height: 500px;
  overflow-y: auto;
  margin: 0;
`;

const copyButtonStyles = css`
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 4px 10px;
  font-size: 12px;
  color: #666;
  background: white;
  border: 1px solid #d0d5dd;
  border-radius: 4px;
  cursor: pointer;
  transition:
    color 0.15s,
    border-color 0.15s,
    background 0.15s;
  z-index: 1;
  font-family: inherit;

  &:hover {
    color: #333;
    border-color: #999;
    background: #f5f5f5;
  }

  &.copied {
    color: #16a34a;
    border-color: #16a34a;
    background: #f0fdf4;
  }
`;

type TreeNodeInternal = {
  key: string;
  title: string;
  isLeaf: boolean;
  content?: string;
  children: Record<string, TreeNodeInternal>;
};

function buildTreeData(sourceFiles: SourceFile[]): TreeNode[] {
  const root: Record<string, TreeNodeInternal> = {};

  for (const file of sourceFiles) {
    const parts = file.filename.split('/').filter(Boolean);
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      const key = parts.slice(0, i + 1).join('/');

      if (!current[part]) {
        current[part] = {
          key,
          title: part,
          isLeaf: isFile,
          ...(isFile ? { content: file.content } : {}),
          children: {},
        };
      }

      current = current[part].children;
    }
  }

  function nodeToTree(node: Record<string, TreeNodeInternal>): TreeNode[] {
    return Object.values(node).map(item => ({
      key: item.key,
      title: item.title,
      isLeaf: item.isLeaf,
      content: item.content,
      children: item.isLeaf ? undefined : nodeToTree(item.children),
    }));
  }

  return nodeToTree(root);
}

function findContentByKey(nodes: TreeNode[], key: string): string | null {
  for (const node of nodes) {
    if (node.key === key) return node.content ?? null;
    if (node.children) {
      const found = findContentByKey(node.children, key);
      if (found) return found;
    }
  }
  return null;
}

export function SourceCodeViewer({ sourceCode, sourceFiles }: SourceCodeViewerProps) {
  const hasMultipleFiles = sourceFiles && sourceFiles.length > 1;
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  const treeData = useMemo(
    () => (hasMultipleFiles ? buildTreeData(sourceFiles) : []),
    [sourceFiles, hasMultipleFiles],
  );

  const activeContent = hasMultipleFiles
    ? ((selectedKey ? findContentByKey(treeData, selectedKey) : null) ?? sourceCode)
    : sourceCode;

  const handleCopy = useCallback(() => {
    navigator.clipboard
      .writeText(activeContent)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        // Fallback: silently ignore clipboard errors
      });
  }, [activeContent]);

  if (!hasMultipleFiles) {
    return (
      <div className={containerStyles}>
        <div className={codeContainerStyles}>
          <button className={`${copyButtonStyles} ${copied ? 'copied' : ''}`} onClick={handleCopy}>
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <pre className={codeBlockStyles}>{sourceCode}</pre>
        </div>
      </div>
    );
  }

  return (
    <div className={containerStyles}>
      <div className={layoutStyles}>
        <div className={treeContainerStyles}>
          <div className={treeWrapperStyles}>
            <Tree
              treeData={treeData}
              selectable
              showLine
              showIcon
              blockNode
              selectedKeys={selectedKey ? [selectedKey] : []}
              expandedKeys={expandedKeys}
              onSelect={(keys: string[]) => {
                if (keys.length > 0) {
                  setSelectedKey(keys[0]);
                  setCopied(false);
                }
              }}
              onExpand={(keys: string[]) => setExpandedKeys(keys)}
            />
          </div>
        </div>
        <div className={codeAreaStyles}>
          <button className={`${copyButtonStyles} ${copied ? 'copied' : ''}`} onClick={handleCopy}>
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <pre className={codeBlockStyles}>{activeContent}</pre>
        </div>
      </div>
    </div>
  );
}
