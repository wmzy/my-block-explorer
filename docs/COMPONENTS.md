# Component Documentation

This document provides detailed information about the React components used in the Block Explorer application.

## TopNavigation Component

The `TopNavigation` component provides a unified navigation bar across all pages of the application.

### Features

- **Global Search**: Smart search input that detects addresses, transaction hashes, and block numbers
- **Chain Selector**: Dropdown to switch between different blockchain networks
- **RPC Configuration**: Quick access to RPC node configuration
- **Responsive Design**: Adapts to mobile and desktop screen sizes
- **Sticky Navigation**: Remains visible when scrolling

### Props

```typescript
type TopNavigationProps = {
  currentChainId: number;
  onChainChange: (chainId: number) => void;
  onSearch: (query: string) => void;
  searchPlaceholder?: string;
};
```

#### Props Description

- `currentChainId`: The currently selected blockchain network ID
- `onChainChange`: Callback function called when user switches chains
- `onSearch`: Callback function called when user performs a search
- `searchPlaceholder`: Optional custom placeholder text for search input

### Usage Example

```tsx
import TopNavigation from './components/TopNavigation';

function App() {
  const [currentChainId, setCurrentChainId] = useState(1);
  
  const handleChainChange = (newChainId: number) => {
    setCurrentChainId(newChainId);
    // Navigate to new chain
    navigate(`/chain/${newChainId}`);
  };
  
  const handleSearch = async (query: string) => {
    // Perform search logic
    const results = await searchBlockchain(query, currentChainId);
    // Handle results...
  };
  
  return (
    <TopNavigation
      currentChainId={currentChainId}
      onChainChange={handleChainChange}
      onSearch={handleSearch}
      searchPlaceholder="Search addresses, transactions, or blocks..."
    />
  );
}
```

### Styling

The component uses Linaria CSS-in-JS for styling with the following key classes:

- `navStyles`: Main navigation container
- `logoStyles`: Logo and branding styles
- `searchContainerStyles`: Search input container
- `searchInputStyles`: Search input field
- `searchButtonStyles`: Search button
- `controlsStyles`: Right-side controls container
- `rpcConfigButtonStyles`: RPC configuration button

### Responsive Behavior

- **Desktop**: Horizontal layout with full-width search
- **Mobile**: Vertical layout with stacked elements
- **Tablet**: Adaptive layout based on screen width

## ChainSelector Component

The `ChainSelector` component (embedded within `TopNavigation`) provides chain switching functionality.

### Features

- **Search Functionality**: Filter chains by name, ID, or token symbol
- **Popular Chain Indicators**: Visual markers for popular chains
- **Testnet Badges**: Special badges for testnet chains
- **Keyboard Navigation**: Support for Enter key selection
- **Click-outside Closing**: Automatically closes when clicking outside

### Chain Data Structure

```typescript
type Chain = {
  id: number;
  name: string;
  nativeCurrency: {
    symbol: string;
  };
};
```

### Chain Configuration

Chains are configured in `src/config/chains.ts` with the following helper functions:

- `getChainInfo(chainId)`: Get full chain information
- `getChainName(chainId)`: Get chain display name
- `getChainSymbol(chainId)`: Get native currency symbol
- `isPopularChain(chainId)`: Check if chain is marked as popular
- `getSortedChains()`: Get all chains sorted by popularity
- `searchChains(query)`: Search chains by query string

### Usage in TopNavigation

The ChainSelector is automatically included in TopNavigation and doesn't need separate import or configuration.

## RpcConfigModal Component

The `RpcConfigModal` component allows users to configure RPC endpoints for different chains.

### Props

```typescript
type RpcConfigModalProps = {
  isOpen: boolean;
  onClose: () => void;
  chainId: number;
};
```

### Features

- **RPC URL Validation**: Validates RPC endpoint connectivity
- **Chain ID Verification**: Ensures RPC matches expected chain
- **Historical Data Testing**: Tests if RPC supports historical queries
- **Event Range Configuration**: Sets maximum block range for event queries
- **Error Feedback**: Provides detailed error messages with cast commands

### Usage Example

```tsx
import RpcConfigModal from './components/RpcConfigModal';

function Page() {
  const [showRpcConfig, setShowRpcConfig] = useState(false);
  const currentChainId = 1;
  
  return (
    <>
      <button onClick={() => setShowRpcConfig(true)}>
        Configure RPC
      </button>
      
      <RpcConfigModal
        isOpen={showRpcConfig}
        onClose={() => setShowRpcConfig(false)}
        chainId={currentChainId}
      />
    </>
  );
}
```

## RpcFunctionError Component

The `RpcFunctionError` component displays function-specific RPC errors with actionable feedback.

### Props

```typescript
type RpcFunctionErrorProps = {
  functionName: string;
  chainId: number;
  chainName: string;
  error: string;
  onConfigureRpc: () => void;
  onRetry?: () => void;
};
```

### Features

- **Function Context**: Shows which function failed
- **Error Analysis**: Provides detailed error analysis
- **Cast Commands**: Generates verification commands for debugging
- **Retry Mechanism**: Optional retry functionality
- **Configuration Access**: Direct link to RPC configuration

### Usage Example

```tsx
import RpcFunctionError from './components/RpcFunctionError';

function ContractPage() {
  const [creationError, setCreationError] = useState<string | null>(null);
  
  if (creationError) {
    return (
      <RpcFunctionError
        functionName="getContractCreationInfo"
        chainId={currentChainId}
        chainName="Ethereum"
        error={creationError}
        onConfigureRpc={() => setShowRpcConfig(true)}
        onRetry={fetchContractCreationInfo}
      />
    );
  }
  
  // ... rest of component
}
```

## Best Practices

### Component Integration

1. **Consistent Navigation**: Always include `TopNavigation` at the top of page components
2. **Chain Context**: Pass current chain ID to all chain-aware components
3. **Error Handling**: Use `RpcFunctionError` for RPC-related failures
4. **Loading States**: Show appropriate loading indicators during async operations

### Performance Optimization

1. **Memoization**: Use React.memo for components that receive stable props
2. **Callback Optimization**: Use useCallback for event handlers passed as props
3. **Search Debouncing**: Implement debouncing for search inputs to reduce API calls

### Accessibility

1. **Keyboard Navigation**: Ensure all interactive elements are keyboard accessible
2. **ARIA Labels**: Provide appropriate ARIA labels for screen readers
3. **Focus Management**: Manage focus appropriately in modals and dropdowns
4. **Color Contrast**: Ensure sufficient color contrast for all text elements

### Testing

1. **Unit Tests**: Test individual component behavior and props
2. **Integration Tests**: Test component interactions and data flow
3. **E2E Tests**: Test complete user workflows across components
4. **Accessibility Tests**: Verify accessibility compliance

### Styling Guidelines

1. **CSS-in-JS**: Use Linaria for component-scoped styles
2. **Responsive Design**: Design mobile-first with progressive enhancement
3. **Theme Consistency**: Use consistent colors, fonts, and spacing
4. **Animation**: Use subtle animations for better user experience

## Component Architecture

```
src/
├── components/
│   ├── TopNavigation.tsx       # Main navigation component
│   ├── RpcConfigModal.tsx      # RPC configuration modal
│   ├── RpcFunctionError.tsx    # RPC error display
│   └── BackendRpcConfig.tsx    # Backend RPC configuration
├── pages/
│   ├── AddressPage.tsx         # Address details page
│   ├── ContractPage.tsx        # Contract details page
│   └── BlockPage.tsx           # Block details page
└── config/
    └── chains.ts               # Chain configuration
```

## Future Enhancements

1. **Theme Support**: Add dark/light theme switching
2. **Bookmarks**: Allow users to bookmark frequently accessed addresses
3. **Recent Searches**: Show recent search history
4. **Advanced Search**: Add filters for search results
5. **Notifications**: Add toast notifications for important events
