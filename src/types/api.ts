export interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  metadata: {
    timestamp: string;
    requestId: string;
    version: string;
  };
}

export interface PaginatedResponse<T> extends APIResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface CreateAliasRequest {
  cardanoAddress: string;
  userEmail?: string;
  customName?: string;
}

export interface AliasResponse {
  shortCode: string;
  cardanoAddress: string;
  customName?: string;
  expiresAt: string;
  qrCodeUrl: string;
  createdAt: string;
}

export interface SearchRequest {
  query: string;
  type?: 'auto' | 'address' | 'transaction' | 'block' | 'alias';
}

export interface SearchResult {
  type: 'address' | 'transaction' | 'block' | 'alias';
  data: AddressDetails | TransactionDetails | BlockDetails | AliasDetails;
  cached: boolean;
}

export interface AddressDetails {
  address: string;
  balance: string;
  stakeAddress?: string;
  transactionCount: number;
  utxoCount: number;
  receivedSum: string;
  sentSum: string;
}

export interface TransactionDetails {
  hash: string;
  block: string;
  blockHeight: number;
  slot: number;
  index: number;
  outputAmount: Array<{
    unit: string;
    quantity: string;
  }>;
  fees: string;
  deposit: string;
  size: number;
  invalidBefore?: string;
  invalidHereafter?: string;
  utxoCount: number;
  withdrawalCount: number;
  mirCertCount: number;
  delegationCount: number;
  stakeCertCount: number;
  poolUpdateCount: number;
  poolRetireCount: number;
  assetMintOrBurnCount: number;
  redeemerCount: number;
  validContract: boolean;
}

export interface BlockDetails {
  hash: string;
  epoch: number;
  slot: number;
  epochSlot: number;
  slotLeader: string;
  size: number;
  txCount: number;
  output?: string;
  fees?: string;
  blockVrf?: string;
  previousBlock?: string;
  nextBlock?: string;
  confirmations: number;
}

export interface AliasDetails {
  shortCode: string;
  cardanoAddress: string;
  customName?: string;
  expiresAt: string;
  isActive: boolean;
  useCount: number;
  createdAt: string;
}

export interface NotificationPreferences {
  aliasExpiry: boolean;
  featureUpdates: boolean;
  ecosystemNews: boolean;
}

export interface HealthCheckResponse {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  version: string;
  dependencies: {
    mongodb: 'connected' | 'disconnected' | 'error';
    redis: 'connected' | 'disconnected' | 'error';
    blockfrost: 'available' | 'unavailable' | 'error';
  };
  uptime: number;
  memoryUsage: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
  };
}
