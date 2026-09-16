import { useState } from 'react';
import type { FormEvent } from 'react';
import { css } from '@linaria/core';
import { Collapsible } from '@/components/ui/Collapsible';
import { getFunctionSelector, formatSelectorForDisplay } from '@/utils/functionSelector';
import { formatResultWithLinks } from '@/utils/addressTypeDetection';
import type { EnhancedContractFunction } from '@/utils/contractInteraction';

const functionNameReadStyles = css`
  font-weight: 600;
  margin-bottom: 12px;
  color: #0066cc;
`;

const functionNameWriteStyles = css`
  font-weight: 600;
  margin-bottom: 12px;
  color: #cc6600;
`;

const mutabilityStyles = css`
  font-size: 12px;
  font-weight: normal;
  margin-left: 8px;
  color: #666;
`;

const inputGroupStyles = css`
  margin-bottom: 12px;
`;

const labelStyles = css`
  display: block;
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 4px;
  color: #333;
`;

const inputStyles = css`
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-family: monospace;
  font-size: 13px;
`;

const buttonReadStyles = css`
  background: #0066cc;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;

  &:hover:not(:disabled) {
    background: #0052a3;
  }

  &:disabled {
    background: #ccc;
    cursor: not-allowed;
  }
`;

const buttonWriteStyles = css`
  background: #cc6600;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;

  &:hover:not(:disabled) {
    background: #b85c00;
  }

  &:disabled {
    background: #ccc;
    cursor: not-allowed;
  }
`;

const resultSuccessStyles = css`
  margin-top: 12px;
  padding: 12px;
  background: #e8f5e8;
  border-radius: 4px;
  border: 1px solid #4caf50;
`;

const resultTitleStyles = css`
  font-size: 14px;
  font-weight: 600;
  color: #2e7d32;
  margin-bottom: 8px;
`;

const resultContentStyles = css`
  font-family: monospace;
  font-size: 12px;
  color: #1b5e20;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
`;

const functionErrorStyles = css`
  margin-top: 12px;
  padding: 12px;
  background: #ffebee;
  border-radius: 4px;
  border: 1px solid #f44336;
`;

const functionErrorTitleStyles = css`
  font-size: 14px;
  font-weight: 600;
  color: #c62828;
  margin-bottom: 8px;
`;

const functionErrorContentStyles = css`
  font-size: 13px;
  color: #b71c1c;
`;

const selectorStyles = css`
  font-family: monospace;
  font-size: 11px;
  padding: 2px 6px;
  background: #e8f0fe;
  border-radius: 4px;
  color: #1a73e8;
`;

// One collapsible form per function: typed argument inputs (payable adds
// value/from), Query vs Simulate submit, and per-call result/error slots
// keyed by call signature.
export function FunctionCallForm({
  func,
  onCall,
  results,
  errors,
  loadingStates,
  chainId,
  blockNumber,
}: {
  func: EnhancedContractFunction;
  onCall: (name: string, args: unknown[], value?: string, from?: string) => void;
  results: Record<string, unknown>;
  errors: Record<string, string>;
  loadingStates: Record<string, boolean>;
  chainId: number;
  blockNumber: string;
}) {
  const [args, setArgs] = useState<string[]>(func.inputs.map(() => ''));
  const [value, setValue] = useState('');
  const [from, setFrom] = useState('');

  const selector = getFunctionSelector(func);
  const selectorDisplay = formatSelectorForDisplay(selector);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();

    // Convert argument types where the string input needs it
    const processedArgs = args.map((arg, index) => {
      const inputType = func.inputs[index].type;

      if (arg.trim() === '') return '';

      if (inputType.startsWith('uint') || inputType.startsWith('int')) {
        return arg;
      }

      if (inputType === 'bool') {
        return arg.toLowerCase() === 'true';
      }

      return arg;
    });

    onCall(func.name, processedArgs, value || undefined, from || undefined);
  };

  const getResultKey = () => {
    if (func.interactionType === 'read') {
      return `${func.name}-${JSON.stringify(args)}-${blockNumber || 'latest'}`;
    } else {
      return `${func.name}-${JSON.stringify(args)}-${value || ''}-${from || ''}`;
    }
  };

  const resultKey = getResultKey();
  const result = results[resultKey];
  const error = errors[resultKey];
  const isLoading = loadingStates[resultKey];

  const headerTitle = (
    <span
      className={func.interactionType === 'read' ? functionNameReadStyles : functionNameWriteStyles}
    >
      {func.name}
      <span className={mutabilityStyles}>{func.stateMutability}</span>
    </span>
  );

  const badge = (
    <span style={{ display: 'flex', gap: '4px' }}>
      {selectorDisplay && <span className={selectorStyles}>{selectorDisplay}</span>}
      <span
        className={selectorStyles}
        style={{ background: func.interactionType === 'read' ? '#d4edda' : '#fff3cd' }}
      >
        {func.interactionType}
      </span>
      <span className={selectorStyles} style={{ background: '#e8f0fe' }}>
        {func.source}
      </span>
    </span>
  );

  return (
    <Collapsible title={headerTitle} defaultExpanded={false} badge={badge}>
      <form onSubmit={handleSubmit}>
        {/* Function Arguments */}
        {func.inputs.map((input, index) => (
          <div key={index} className={inputGroupStyles}>
            <label className={labelStyles}>
              {input.name} ({input.type})
            </label>
            <input
              type="text"
              value={args[index]}
              onChange={e => {
                const newArgs = [...args];
                newArgs[index] = e.target.value;
                setArgs(newArgs);
              }}
              placeholder={`Enter ${input.type}`}
              className={inputStyles}
            />
          </div>
        ))}

        {/* Write function additional fields */}
        {func.interactionType === 'write' && (
          <>
            {func.stateMutability === 'payable' && (
              <div className={inputGroupStyles}>
                <label className={labelStyles}>Value (wei)</label>
                <input
                  type="text"
                  value={value}
                  onChange={e => setValue(e.target.value)}
                  placeholder="0"
                  className={inputStyles}
                />
              </div>
            )}

            <div className={inputGroupStyles}>
              <label className={labelStyles}>From Address (optional)</label>
              <input
                type="text"
                value={from}
                onChange={e => setFrom(e.target.value)}
                placeholder="0x..."
                className={inputStyles}
              />
            </div>
          </>
        )}

        <button
          type="submit"
          disabled={isLoading}
          className={func.interactionType === 'read' ? buttonReadStyles : buttonWriteStyles}
        >
          {isLoading ? 'Loading...' : func.interactionType === 'read' ? 'Query' : 'Simulate'}
        </button>

        {/* Results */}
        {result !== undefined && (
          <div className={resultSuccessStyles}>
            <div className={resultTitleStyles}>Result:</div>
            <div className={resultContentStyles}>
              {typeof result === 'object'
                ? formatResultWithLinks(result, {
                    chainId,
                    outputs: func.outputs,
                  })
                : String(result)}
            </div>
          </div>
        )}

        {/* Errors */}
        {error && (
          <div className={functionErrorStyles}>
            <div className={functionErrorTitleStyles}>Error:</div>
            <div className={functionErrorContentStyles}>{error}</div>
          </div>
        )}
      </form>
    </Collapsible>
  );
}
