import { useState, useCallback } from 'react';
import { css } from '@linaria/core';

type SourceFile = {
  filename: string;
  content: string;
};

type SourceCodeViewerProps = {
  sourceCode: string;
  sourceFiles?: SourceFile[];
};

const containerStyles = css`
  position: relative;
  border: 1px solid #e1e5e9;
  border-radius: 6px;
  overflow: hidden;
`;

const tabBarStyles = css`
  display: flex;
  overflow-x: auto;
  border-bottom: 1px solid #e1e5e9;
  background: #f0f2f5;
  scrollbar-width: thin;

  &::-webkit-scrollbar {
    height: 4px;
  }

  &::-webkit-scrollbar-thumb {
    background: #c0c4cc;
    border-radius: 2px;
  }
`;

const tabStyles = css`
  padding: 8px 16px;
  font-size: 13px;
  font-family:
    'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
  color: #666;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  white-space: nowrap;
  transition:
    color 0.15s,
    border-color 0.15s,
    background 0.15s;

  &:hover {
    color: #333;
    background: #e8eaed;
  }

  &.active {
    color: #1a1a1a;
    border-bottom-color: #2563eb;
    background: white;
    font-weight: 500;
  }
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

export function SourceCodeViewer({ sourceCode, sourceFiles }: SourceCodeViewerProps) {
  const hasMultipleFiles = sourceFiles && sourceFiles.length > 1;
  const [activeIndex, setActiveIndex] = useState(0);
  const [copied, setCopied] = useState(false);

  const activeContent = hasMultipleFiles ? (sourceFiles[activeIndex]?.content ?? '') : sourceCode;

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
      <div className={tabBarStyles}>
        {sourceFiles.map((file, index) => (
          <button
            key={file.filename}
            className={`${tabStyles} ${index === activeIndex ? 'active' : ''}`}
            onClick={() => {
              setActiveIndex(index);
              setCopied(false);
            }}
          >
            {file.filename}
          </button>
        ))}
      </div>
      <div className={codeContainerStyles}>
        <button className={`${copyButtonStyles} ${copied ? 'copied' : ''}`} onClick={handleCopy}>
          {copied ? 'Copied!' : 'Copy'}
        </button>
        <pre className={codeBlockStyles}>{activeContent}</pre>
      </div>
    </div>
  );
}
