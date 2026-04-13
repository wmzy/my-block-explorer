import { getChainInfo } from './chains';

export type ExternalTool = {
  name: string;
  url: string;
};

export function getExternalToolLinks(chainId: number, address: string): ExternalTool[] {
  const chain = getChainInfo(chainId);
  const links: ExternalTool[] = [];

  const explorerUrl = chain?.blockExplorers?.default?.url;
  if (explorerUrl) {
    links.push({
      name: chain.blockExplorers?.default?.name ?? 'Explorer',
      url: `${explorerUrl}/address/${address}`,
    });
  }

  links.push({
    name: 'Routescan',
    url: `https://routescan.io/address/${address}`,
  });

  const chainShortName = getChainShortName(chainId);
  if (chainShortName) {
    links.push({
      name: 'EVMole',
      url: `https://evmole.xyz/#/${address}/${chainShortName}`,
    });
  }

  return links;
}

export function getExternalTxLinks(chainId: number, txHash: string): ExternalTool[] {
  const chain = getChainInfo(chainId);
  const links: ExternalTool[] = [];

  const explorerUrl = chain?.blockExplorers?.default?.url;
  if (explorerUrl) {
    links.push({
      name: chain.blockExplorers?.default?.name ?? 'Explorer',
      url: `${explorerUrl}/tx/${txHash}`,
    });
  }

  links.push({
    name: 'Routescan',
    url: `https://routescan.io/tx/${txHash}`,
  });

  return links;
}

export function getExternalBlockLinks(chainId: number, blockNumber: string): ExternalTool[] {
  const chain = getChainInfo(chainId);
  const links: ExternalTool[] = [];

  const explorerUrl = chain?.blockExplorers?.default?.url;
  if (explorerUrl) {
    links.push({
      name: chain.blockExplorers?.default?.name ?? 'Explorer',
      url: `${explorerUrl}/block/${blockNumber}`,
    });
  }

  links.push({
    name: 'Routescan',
    url: `https://routescan.io/block/${blockNumber}`,
  });

  return links;
}

const CHAIN_SHORT_NAMES: Record<number, string> = {
  1: 'eth',
  10: 'oeth',
  56: 'bsc',
  100: 'gno',
  137: 'matic',
  250: 'ftm',
  288: 'boba',
  324: 'zksync',
  1101: 'polygonzkevm',
  8453: 'base',
  42161: 'arb',
  42220: 'celo',
  43114: 'avax',
  534352: 'scr',
  59144: 'linea',
  7777777: 'zora',
};

function getChainShortName(chainId: number): string | null {
  return CHAIN_SHORT_NAMES[chainId] ?? null;
}
