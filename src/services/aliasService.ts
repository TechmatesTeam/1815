import mongoose from 'mongoose';
import { Alias, IAliasDocument } from '@/models/Alias';
import { cacheService, CacheKeys, CacheTTL } from './cacheService';
import { generateShortCode, isValidCardanoAddress } from '@/utils/validation';
import { logger } from '@/utils/logger';
import QRCode from 'qrcode';
import { config } from '@/config/environment';

// In-memory storage for mock mode
const mockAliases = new Map<string, any>();

export interface CreateAliasRequest {
  cardanoAddress: string;
  userEmail?: string;
  customName?: string;
  expiryDays?: number;
}

export interface AliasResponse {
  shortCode: string;
  cardanoAddress: string;
  customName?: string;
  expiresAt: string;
  qrCodeUrl: string;
  createdAt: string;
}

export interface ResolveAliasResponse {
  cardanoAddress: string;
  customName?: string;
  expiresAt: string;
  useCount: number;
  lastUsedAt?: string;
  createdAt?: string;
}

export interface AliasPreviewRequest {
  cardanoAddress: string;
  userEmail?: string;
  customName?: string;
  expiryDays?: number;
}

export interface AliasPreviewResponse {
  shortCode: string;
  cardanoAddress: string;
  customName?: string;
  expiresAt: string;
  qrCodeUrl: string;
  previewOnly: true;
}

export interface ConfirmAliasRequest {
  shortCode: string;
  cardanoAddress: string;
  userEmail?: string;
  customName?: string;
  expiryDays?: number;
}

export class AliasService {
  private readonly maxRetries = 10;
  private readonly defaultExpiryDays = 30;
  private readonly maxExpiryDays = 30; // Free tier limit

  /**
   * Check if we're running in mock mode (no database connection)
   */
  private isMockMode(): boolean {
    return mongoose.connection.readyState !== 1;
  }

  /**
   * Generate a unique 16-digit numeric code with collision detection
   */
  private async generateUniqueShortCode(): Promise<string> {
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      // Generate 16-digit numeric code (timestamp-based for uniqueness)
      const shortCode = generateShortCode(16);

      if (this.isMockMode()) {
        // In mock mode, check in-memory storage
        if (!mockAliases.has(shortCode)) {
          logger.debug(
            `Generated unique 16-digit code (mock): ${shortCode} (attempt ${attempt + 1})`
          );
          return shortCode;
        }
      } else {
        // Check if code already exists in database
        const existingAlias = await Alias.findOne({ shortCode });

        if (!existingAlias) {
          logger.debug(`Generated unique 16-digit code: ${shortCode} (attempt ${attempt + 1})`);
          return shortCode;
        }
      }

      logger.debug(`16-digit code collision detected: ${shortCode} (attempt ${attempt + 1})`);

      // Add small delay to ensure timestamp changes for next attempt
      await new Promise(resolve => setTimeout(resolve, 1));
    }

    throw new Error('Failed to generate unique 16-digit code after maximum retries');
  }

  /**
   * Generate QR code for the alias
   */
  private async generateQRCode(shortCode: string): Promise<string> {
    try {
      const aliasUrl = `${config.app.baseUrl}/resolve/${shortCode}`;

      // Generate QR code as data URL
      const qrCodeDataUrl = await QRCode.toDataURL(aliasUrl, {
        errorCorrectionLevel: 'M',
        margin: 1,
        color: {
          dark: '#000000',
          light: '#FFFFFF',
        },
        width: 256,
      });

      // For now, return the data URL directly
      // In production, this would be uploaded to S3 and return the S3 URL
      return qrCodeDataUrl;
    } catch (error) {
      logger.error('QR code generation failed:', error);
      throw new Error('Failed to generate QR code');
    }
  }

  /**
   * Calculate expiry date based on days from now
   */
  private calculateExpiryDate(expiryDays?: number): Date {
    const days = Math.min(expiryDays || this.defaultExpiryDays, this.maxExpiryDays);
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + days);
    return expiryDate;
  }

  /**
   * Generate a preview of an alias without saving to database
   */
  async previewAlias(request: AliasPreviewRequest): Promise<AliasPreviewResponse> {
    // Validate Cardano address
    if (!isValidCardanoAddress(request.cardanoAddress)) {
      throw new Error('Invalid Cardano address format');
    }

    // Check if this address already has an active alias
    if (this.isMockMode()) {
      // Check in-memory storage for existing active alias for this address
      for (const [shortCode, alias] of mockAliases.entries()) {
        if (
          alias.cardanoAddress === request.cardanoAddress.trim() &&
          alias.isActive &&
          new Date(alias.expiresAt) > new Date()
        ) {
          throw new Error(
            'This wallet address already has an active alias. Only one alias per address is allowed.'
          );
        }
      }
    } else {
      // Check for existing active alias for this address
      const existingAddressAlias = await Alias.findOne({
        cardanoAddress: request.cardanoAddress.trim(),
        isActive: true,
        expiresAt: { $gt: new Date() },
      });

      if (existingAddressAlias) {
        throw new Error(
          'This wallet address already has an active alias. Only one alias per address is allowed.'
        );
      }
    }

    // Generate unique short code
    const shortCode = await this.generateUniqueShortCode();

    // Calculate expiry date
    const expiresAt = this.calculateExpiryDate(request.expiryDays);

    // Generate QR code
    const qrCodeUrl = await this.generateQRCode(shortCode);

    logger.info(`Alias preview generated: ${shortCode} -> ${request.cardanoAddress}`);

    return {
      shortCode,
      cardanoAddress: request.cardanoAddress.trim(),
      customName: request.customName?.trim(),
      expiresAt: expiresAt.toISOString(),
      qrCodeUrl,
      previewOnly: true,
    };
  }

  /**
   * Confirm and save an alias to the database
   */
  async confirmAlias(request: ConfirmAliasRequest): Promise<AliasResponse> {
    // Validate Cardano address
    if (!isValidCardanoAddress(request.cardanoAddress)) {
      throw new Error('Invalid Cardano address format');
    }

    // Check if this address already has an active alias
    if (this.isMockMode()) {
      // Check in-memory storage for existing active alias for this address
      for (const [shortCode, alias] of mockAliases.entries()) {
        if (
          alias.cardanoAddress === request.cardanoAddress.trim() &&
          alias.isActive &&
          new Date(alias.expiresAt) > new Date()
        ) {
          throw new Error(
            'This wallet address already has an active alias. Only one alias per address is allowed.'
          );
        }
      }

      if (mockAliases.has(request.shortCode)) {
        throw new Error('Short code already exists, please generate a new preview');
      }
    } else {
      // Check for existing active alias for this address
      const existingAddressAlias = await Alias.findOne({
        cardanoAddress: request.cardanoAddress.trim(),
        isActive: true,
        expiresAt: { $gt: new Date() },
      });

      if (existingAddressAlias) {
        throw new Error(
          'This wallet address already has an active alias. Only one alias per address is allowed.'
        );
      }

      const existingAlias = await Alias.findOne({ shortCode: request.shortCode });
      if (existingAlias) {
        throw new Error('Short code already exists, please generate a new preview');
      }
    }

    // Calculate expiry date
    const expiresAt = this.calculateExpiryDate(request.expiryDays);

    // Generate QR code (regenerate to ensure consistency)
    const qrCodeUrl = await this.generateQRCode(request.shortCode);

    // Create alias data
    const aliasData = {
      shortCode: request.shortCode,
      cardanoAddress: request.cardanoAddress.trim(),
      customName: request.customName?.trim(),
      userEmail: request.userEmail?.trim().toLowerCase(),
      expiresAt,
      qrCodeUrl,
      isActive: true,
      useCount: 0,
      createdAt: new Date(),
    };

    try {
      if (this.isMockMode()) {
        // Store in memory for mock mode
        mockAliases.set(request.shortCode, aliasData);
        logger.info(
          `Alias confirmed and created (mock): ${request.shortCode} -> ${request.cardanoAddress}`
        );
      } else {
        // Store in database for production mode
        const alias = new Alias(aliasData);
        await alias.save();

        // Cache the alias for fast resolution
        try {
          await cacheService.set(
            request.shortCode,
            {
              cardanoAddress: alias.cardanoAddress,
              customName: alias.customName,
              expiresAt: alias.expiresAt.toISOString(),
              isActive: alias.isActive,
              useCount: alias.useCount,
            },
            { prefix: CacheKeys.ALIAS, ttl: CacheTTL.ALIAS }
          );
        } catch (cacheError) {
          // Cache failure shouldn't break alias creation
          logger.warn('Failed to cache alias:', cacheError);
        }

        logger.info(
          `Alias confirmed and created: ${request.shortCode} -> ${request.cardanoAddress}`
        );
      }

      return {
        shortCode: aliasData.shortCode,
        cardanoAddress: aliasData.cardanoAddress,
        customName: aliasData.customName,
        expiresAt: aliasData.expiresAt.toISOString(),
        qrCodeUrl: aliasData.qrCodeUrl,
        createdAt: aliasData.createdAt.toISOString(),
      };
    } catch (error) {
      logger.error('Alias confirmation failed:', error);

      if (error instanceof Error && error.message.includes('Short code already exists')) {
        throw new Error('Short code collision detected, please generate a new preview');
      }

      throw new Error('Failed to confirm alias');
    }
  }

  /**
   * Create a new alias (legacy method - now creates directly without preview)
   */
  async createAlias(request: CreateAliasRequest): Promise<AliasResponse> {
    // Validate Cardano address
    if (!isValidCardanoAddress(request.cardanoAddress)) {
      throw new Error('Invalid Cardano address format');
    }

    // Check if this address already has an active alias
    if (this.isMockMode()) {
      // Check in-memory storage for existing active alias for this address
      for (const [shortCode, alias] of mockAliases.entries()) {
        if (
          alias.cardanoAddress === request.cardanoAddress.trim() &&
          alias.isActive &&
          new Date(alias.expiresAt) > new Date()
        ) {
          throw new Error(
            'This wallet address already has an active alias. Only one alias per address is allowed.'
          );
        }
      }
    } else {
      // Check for existing active alias for this address
      const existingAddressAlias = await Alias.findOne({
        cardanoAddress: request.cardanoAddress.trim(),
        isActive: true,
        expiresAt: { $gt: new Date() },
      });

      if (existingAddressAlias) {
        throw new Error(
          'This wallet address already has an active alias. Only one alias per address is allowed.'
        );
      }
    }

    // Generate unique short code
    const shortCode = await this.generateUniqueShortCode();

    // Calculate expiry date
    const expiresAt = this.calculateExpiryDate(request.expiryDays);

    // Generate QR code
    const qrCodeUrl = await this.generateQRCode(shortCode);

    // Create alias data
    const aliasData = {
      shortCode,
      cardanoAddress: request.cardanoAddress.trim(),
      customName: request.customName?.trim(),
      userEmail: request.userEmail?.trim().toLowerCase(),
      expiresAt,
      qrCodeUrl,
      isActive: true,
      useCount: 0,
      createdAt: new Date(),
    };

    try {
      if (this.isMockMode()) {
        // Store in memory for mock mode
        mockAliases.set(shortCode, aliasData);
        logger.info(`Alias created successfully (mock): ${shortCode} -> ${request.cardanoAddress}`);
      } else {
        // Store in database for production mode
        const alias = new Alias(aliasData);
        await alias.save();

        // Cache the alias for fast resolution
        try {
          await cacheService.set(
            shortCode,
            {
              cardanoAddress: alias.cardanoAddress,
              customName: alias.customName,
              expiresAt: alias.expiresAt.toISOString(),
              isActive: alias.isActive,
              useCount: alias.useCount,
            },
            { prefix: CacheKeys.ALIAS, ttl: CacheTTL.ALIAS }
          );
        } catch (cacheError) {
          // Cache failure shouldn't break alias creation
          logger.warn('Failed to cache alias:', cacheError);
        }

        logger.info(`Alias created successfully: ${shortCode} -> ${request.cardanoAddress}`);
      }

      return {
        shortCode,
        cardanoAddress: aliasData.cardanoAddress,
        customName: aliasData.customName,
        expiresAt: aliasData.expiresAt.toISOString(),
        qrCodeUrl: aliasData.qrCodeUrl,
        createdAt: aliasData.createdAt.toISOString(),
      };
    } catch (error) {
      logger.error('Alias creation failed:', error);

      if (error instanceof Error && error.message.includes('Short code already exists')) {
        throw new Error('Short code collision detected, please try again');
      }

      throw new Error('Failed to create alias');
    }
  }

  /**
   * Resolve an alias to get the Cardano address
   */
  async resolveAlias(shortCode: string): Promise<ResolveAliasResponse> {
    if (!shortCode || typeof shortCode !== 'string') {
      throw new Error('Invalid short code provided');
    }

    const cleanShortCode = shortCode.trim();

    if (this.isMockMode()) {
      // Mock mode: check in-memory storage
      const mockAlias = mockAliases.get(cleanShortCode);

      if (!mockAlias) {
        throw new Error('Alias not found');
      }

      // Check if alias is active and not expired
      if (!mockAlias.isActive) {
        throw new Error('Alias is inactive');
      }

      if (new Date(mockAlias.expiresAt) <= new Date()) {
        throw new Error('Alias has expired');
      }

      // Increment use count
      mockAlias.useCount += 1;
      mockAlias.lastUsedAt = new Date();

      logger.info(
        `Alias resolved (mock): ${cleanShortCode} -> ${mockAlias.cardanoAddress} (use count: ${mockAlias.useCount})`
      );

      return {
        cardanoAddress: mockAlias.cardanoAddress,
        customName: mockAlias.customName,
        expiresAt: mockAlias.expiresAt.toISOString(),
        useCount: mockAlias.useCount,
        lastUsedAt: mockAlias.lastUsedAt.toISOString(),
      };
    }

    // Production mode: use cache and database
    try {
      // Try cache first
      const cachedAlias = await cacheService.get<{
        cardanoAddress: string;
        customName?: string;
        expiresAt: string;
        isActive: boolean;
        useCount: number;
      }>(cleanShortCode, { prefix: CacheKeys.ALIAS });

      if (cachedAlias) {
        // Check if cached alias is still valid
        const expiresAt = new Date(cachedAlias.expiresAt);
        if (cachedAlias.isActive && expiresAt > new Date()) {
          // Increment use count in background (don't await)
          this.incrementUseCountAsync(cleanShortCode);

          return {
            cardanoAddress: cachedAlias.cardanoAddress,
            customName: cachedAlias.customName,
            expiresAt: cachedAlias.expiresAt,
            useCount: cachedAlias.useCount + 1, // Return incremented count
          };
        } else {
          // Remove expired/inactive alias from cache
          await cacheService.delete(cleanShortCode, { prefix: CacheKeys.ALIAS });
        }
      }
    } catch (cacheError) {
      logger.warn('Cache operation failed, falling back to database:', cacheError);
    }

    // Fallback to database
    const alias = await Alias.findOne({ shortCode: cleanShortCode });

    if (!alias) {
      throw new Error('Alias not found');
    }

    // Check if alias is active and not expired
    if (!alias.isActive) {
      throw new Error('Alias is inactive');
    }

    if (alias.isExpired()) {
      throw new Error('Alias has expired');
    }

    // Increment use count
    await alias.incrementUseCount();

    // Update cache with fresh data
    try {
      await cacheService.set(
        cleanShortCode,
        {
          cardanoAddress: alias.cardanoAddress,
          customName: alias.customName,
          expiresAt: alias.expiresAt.toISOString(),
          isActive: alias.isActive,
          useCount: alias.useCount,
        },
        { prefix: CacheKeys.ALIAS, ttl: CacheTTL.ALIAS }
      );
    } catch (cacheError) {
      logger.warn('Failed to update cache:', cacheError);
    }

    logger.info(
      `Alias resolved: ${cleanShortCode} -> ${alias.cardanoAddress} (use count: ${alias.useCount})`
    );

    return {
      cardanoAddress: alias.cardanoAddress,
      customName: alias.customName,
      expiresAt: alias.expiresAt.toISOString(),
      useCount: alias.useCount,
      lastUsedAt: alias.lastUsedAt?.toISOString(),
    };
  }

  /**
   * Increment use count asynchronously (for cached responses)
   */
  private async incrementUseCountAsync(shortCode: string): Promise<void> {
    try {
      const alias = await Alias.findOne({ shortCode });
      if (alias && alias.isActive && !alias.isExpired()) {
        await alias.incrementUseCount();

        // Update cache with new use count
        await cacheService.set(
          shortCode,
          {
            cardanoAddress: alias.cardanoAddress,
            customName: alias.customName,
            expiresAt: alias.expiresAt.toISOString(),
            isActive: alias.isActive,
            useCount: alias.useCount,
          },
          { prefix: CacheKeys.ALIAS, ttl: CacheTTL.ALIAS }
        );
      }
    } catch (error) {
      logger.error('Failed to increment use count asynchronously:', error);
      // Don't throw error as this is a background operation
    }
  }

  /**
   * Get alias details by short code (without incrementing use count)
   */
  async getAliasDetails(shortCode: string): Promise<AliasResponse | null> {
    if (!shortCode || typeof shortCode !== 'string') {
      return null;
    }

    const cleanShortCode = shortCode.trim();

    if (this.isMockMode()) {
      // Mock mode: check in-memory storage
      const mockAlias = mockAliases.get(cleanShortCode);

      if (!mockAlias || !mockAlias.isActive || new Date(mockAlias.expiresAt) <= new Date()) {
        return null;
      }

      return {
        shortCode: mockAlias.shortCode,
        cardanoAddress: mockAlias.cardanoAddress,
        customName: mockAlias.customName,
        expiresAt: mockAlias.expiresAt.toISOString(),
        qrCodeUrl: mockAlias.qrCodeUrl || '',
        createdAt: mockAlias.createdAt.toISOString(),
      };
    }

    // Production mode: use cache and database
    try {
      // Try cache first
      const cachedAlias = await cacheService.get<{
        cardanoAddress: string;
        customName?: string;
        expiresAt: string;
        isActive: boolean;
        useCount: number;
      }>(cleanShortCode, { prefix: CacheKeys.ALIAS });

      if (cachedAlias && cachedAlias.isActive && new Date(cachedAlias.expiresAt) > new Date()) {
        // For details, we need to get the full alias from database to get createdAt and qrCodeUrl
        const alias = await Alias.findOne({ shortCode: cleanShortCode });
        if (alias) {
          return {
            shortCode: alias.shortCode,
            cardanoAddress: alias.cardanoAddress,
            customName: alias.customName,
            expiresAt: alias.expiresAt.toISOString(),
            qrCodeUrl: alias.qrCodeUrl || '',
            createdAt: alias.createdAt.toISOString(),
          };
        }
      }
    } catch (cacheError) {
      logger.warn('Cache operation failed:', cacheError);
    }

    // Fallback to database
    const alias = await Alias.findOne({ shortCode: cleanShortCode });

    if (!alias || !alias.isActive || alias.isExpired()) {
      return null;
    }

    return {
      shortCode: alias.shortCode,
      cardanoAddress: alias.cardanoAddress,
      customName: alias.customName,
      expiresAt: alias.expiresAt.toISOString(),
      qrCodeUrl: alias.qrCodeUrl || '',
      createdAt: alias.createdAt.toISOString(),
    };
  }

  /**
   * Delete an alias (deactivate it)
   */
  async deleteAlias(shortCode: string): Promise<boolean> {
    if (!shortCode || typeof shortCode !== 'string') {
      return false;
    }

    const cleanShortCode = shortCode.trim();

    if (this.isMockMode()) {
      // Mock mode: deactivate in memory
      const mockAlias = mockAliases.get(cleanShortCode);
      if (mockAlias && mockAlias.isActive) {
        mockAlias.isActive = false;
        logger.info(`Alias deactivated (mock): ${cleanShortCode}`);
        return true;
      }
      return false;
    }

    // Production mode: use database
    try {
      const result = await Alias.updateOne(
        { shortCode: cleanShortCode, isActive: true },
        { $set: { isActive: false } }
      );

      if (result.modifiedCount > 0) {
        // Remove from cache
        try {
          await cacheService.delete(cleanShortCode, { prefix: CacheKeys.ALIAS });
        } catch (cacheError) {
          logger.warn('Failed to remove from cache:', cacheError);
        }
        logger.info(`Alias deactivated: ${cleanShortCode}`);
        return true;
      }

      return false;
    } catch (error) {
      logger.error('Failed to delete alias:', error);
      return false;
    }
  }

  /**
   * Get aliases by Cardano address
   */
  async getAliasesByAddress(cardanoAddress: string): Promise<AliasResponse[]> {
    if (!isValidCardanoAddress(cardanoAddress)) {
      throw new Error('Invalid Cardano address format');
    }

    const cleanAddress = cardanoAddress.trim();

    if (this.isMockMode()) {
      // Mock mode: search in-memory storage
      const matchingAliases: AliasResponse[] = [];

      for (const [shortCode, alias] of mockAliases.entries()) {
        if (
          alias.cardanoAddress === cleanAddress &&
          alias.isActive &&
          new Date(alias.expiresAt) > new Date()
        ) {
          matchingAliases.push({
            shortCode: alias.shortCode,
            cardanoAddress: alias.cardanoAddress,
            customName: alias.customName,
            expiresAt: alias.expiresAt.toISOString(),
            qrCodeUrl: alias.qrCodeUrl || '',
            createdAt: alias.createdAt.toISOString(),
          });
        }
      }

      // Sort by creation date (newest first) and limit to 50
      return matchingAliases
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 50);
    }

    // Production mode: use database
    const aliases = await Alias.findActive({ cardanoAddress: cleanAddress })
      .sort({ createdAt: -1 })
      .limit(50); // Limit to prevent abuse

    return aliases.map(alias => ({
      shortCode: alias.shortCode,
      cardanoAddress: alias.cardanoAddress,
      customName: alias.customName,
      expiresAt: alias.expiresAt.toISOString(),
      qrCodeUrl: alias.qrCodeUrl || '',
      createdAt: alias.createdAt.toISOString(),
    }));
  }
}

// Create singleton instance
export const aliasService = new AliasService();
