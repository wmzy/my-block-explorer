import type { DiscoveryStatus, ServiceInfo } from '@/hooks/useAutoDiscovery';
import { ScanningScreen } from './ScanningScreen';
import { SetupRequiredScreen } from './SetupRequiredScreen';

const DEFAULT_PORTS = [8201, 8202, 8203, 8204, 8205];

type ServiceSetupProps = {
  status: DiscoveryStatus;
  serviceInfo: ServiceInfo | null;
  error: string | null;
  isScanning: boolean;
  currentPort: number | null;
  setApiUrl: (url: string) => Promise<boolean>;
  discover: () => Promise<ServiceInfo | null>;
  reset: () => void;
};

export function ServiceSetup({
  status,
  serviceInfo: _serviceInfo,
  error,
  isScanning,
  currentPort,
  setApiUrl,
  discover,
  reset: _reset,
}: ServiceSetupProps) {
  if (status === 'discovering' || status === 'idle') {
    const portIndex = currentPort ? DEFAULT_PORTS.indexOf(currentPort) + 1 : 1;
    return (
      <ScanningScreen
        currentPort={currentPort}
        portIndex={portIndex}
        totalPorts={DEFAULT_PORTS.length}
      />
    );
  }

  return (
    <SetupRequiredScreen
      error={error}
      isConnecting={isScanning}
      onSetApiUrl={setApiUrl}
      onDiscover={discover}
    />
  );
}
