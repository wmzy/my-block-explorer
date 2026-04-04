import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { useAutoDiscovery } from '@/hooks/useAutoDiscovery';

type ServiceDiscoveryContextValue = ReturnType<typeof useAutoDiscovery>;

const ServiceDiscoveryContext = createContext<ServiceDiscoveryContextValue | null>(null);

type ServiceDiscoveryProviderProps = {
  children: ReactNode;
};

export function ServiceDiscoveryProvider({ children }: ServiceDiscoveryProviderProps) {
  const discovery = useAutoDiscovery();

  return (
    <ServiceDiscoveryContext.Provider value={discovery}>
      {children}
    </ServiceDiscoveryContext.Provider>
  );
}

export function useServiceDiscovery(): ServiceDiscoveryContextValue {
  const context = useContext(ServiceDiscoveryContext);
  if (!context) {
    throw new Error('useServiceDiscovery must be used within a ServiceDiscoveryProvider');
  }
  return context;
}

export { ServiceDiscoveryContext };
