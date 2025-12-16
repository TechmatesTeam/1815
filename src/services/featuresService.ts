import * as fs from 'fs/promises';
import * as path from 'path';
import { cacheService, CacheKeys } from '@/services/cacheService';
import { logger } from '@/utils/logger';

export interface Feature {
  id: string;
  icon: string;
  title: string;
  description: string;
  bgColor: string;
  iconBg: string;
  status: 'available' | 'upcoming';
  version: string;
  actionText?: string;
  actionLink?: string;
  category: string;
}

export interface FeaturesData {
  currentVersion: string;
  features: Feature[];
  categories: Record<string, string>;
}

class FeaturesService {
  private featuresFilePath: string;

  constructor() {
    this.featuresFilePath = path.join(__dirname, '../data/features.json');
  }

  /**
   * Get all features data with caching
   */
  async getFeatures(): Promise<FeaturesData> {
    try {
      // Try cache first (but don't fail if cache is unavailable)
      try {
        const cached = await cacheService.get<FeaturesData>('features_data', {
          prefix: CacheKeys.FEATURES,
        });

        if (cached) {
          logger.debug('Features data retrieved from cache');
          return cached;
        }
      } catch (cacheError) {
        logger.debug('Cache unavailable, loading from file directly');
      }

      // Load from file
      const featuresData = await this.loadFeaturesFromFile();

      // Try to cache for 1 hour (but don't fail if cache is unavailable)
      try {
        await cacheService.set('features_data', featuresData, {
          prefix: CacheKeys.FEATURES,
          ttl: 3600,
        });
        logger.info('Features data loaded from file and cached');
      } catch (cacheError) {
        logger.info('Features data loaded from file (cache unavailable)');
      }

      return featuresData;
    } catch (error) {
      logger.error('Failed to get features data:', error);
      throw new Error('Failed to load features data');
    }
  }

  /**
   * Get features by status
   */
  async getFeaturesByStatus(status: 'available' | 'upcoming'): Promise<Feature[]> {
    try {
      const featuresData = await this.getFeatures();
      return featuresData.features.filter(feature => feature.status === status);
    } catch (error) {
      logger.error('Failed to get features by status:', error);
      throw new Error('Failed to filter features by status');
    }
  }

  /**
   * Get features by category
   */
  async getFeaturesByCategory(category: string): Promise<Feature[]> {
    try {
      const featuresData = await this.getFeatures();
      return featuresData.features.filter(feature => feature.category === category);
    } catch (error) {
      logger.error('Failed to get features by category:', error);
      throw new Error('Failed to filter features by category');
    }
  }

  /**
   * Get feature by ID
   */
  async getFeatureById(id: string): Promise<Feature | null> {
    try {
      const featuresData = await this.getFeatures();
      return featuresData.features.find(feature => feature.id === id) || null;
    } catch (error) {
      logger.error('Failed to get feature by ID:', error);
      throw new Error('Failed to find feature');
    }
  }

  /**
   * Get current version
   */
  async getCurrentVersion(): Promise<string> {
    try {
      const featuresData = await this.getFeatures();
      return featuresData.currentVersion;
    } catch (error) {
      logger.error('Failed to get current version:', error);
      throw new Error('Failed to get current version');
    }
  }

  /**
   * Get available categories
   */
  async getCategories(): Promise<Record<string, string>> {
    try {
      const featuresData = await this.getFeatures();
      return featuresData.categories;
    } catch (error) {
      logger.error('Failed to get categories:', error);
      throw new Error('Failed to get categories');
    }
  }

  /**
   * Invalidate features cache (for admin use)
   */
  async invalidateCache(): Promise<void> {
    try {
      await cacheService.delete('features_data', {
        prefix: CacheKeys.FEATURES,
      });
      logger.info('Features cache invalidated');
    } catch (error) {
      logger.error('Failed to invalidate features cache:', error);
      throw new Error('Failed to invalidate cache');
    }
  }

  /**
   * Load features data from JSON file
   */
  private async loadFeaturesFromFile(): Promise<FeaturesData> {
    try {
      const fileContent = await fs.readFile(this.featuresFilePath, 'utf-8');
      const featuresData: FeaturesData = JSON.parse(fileContent);

      // Validate the data structure
      if (!featuresData.currentVersion || !Array.isArray(featuresData.features)) {
        throw new Error('Invalid features data structure');
      }

      // Validate each feature
      for (const feature of featuresData.features) {
        if (!feature.id || !feature.title || !feature.description || !feature.status) {
          throw new Error(`Invalid feature data: ${JSON.stringify(feature)}`);
        }
      }

      return featuresData;
    } catch (error) {
      logger.error('Failed to load features from file:', error);

      // Return fallback data if file loading fails
      return this.getFallbackFeaturesData();
    }
  }

  /**
   * Get fallback features data in case file loading fails
   */
  private getFallbackFeaturesData(): FeaturesData {
    return {
      currentVersion: '1.0.0',
      features: [
        {
          id: 'instant-resolution',
          icon: '🔧',
          title: 'Instant Resolution',
          description: 'Resolve aliases to full wallet addresses in milliseconds',
          bgColor: 'bg-yellow-100',
          iconBg: 'bg-yellow-500',
          status: 'available',
          version: '1.0.0',
          actionText: 'Try Explorer',
          actionLink: '#explorer',
          category: 'core',
        },
        {
          id: 'alias-explorer',
          icon: '🔍',
          title: 'Alias Explorer',
          description: 'Search and explore existing aliases on the network',
          bgColor: 'bg-blue-100',
          iconBg: 'bg-blue-500',
          status: 'available',
          version: '1.0.0',
          actionText: 'Try Explorer',
          actionLink: '#explorer',
          category: 'core',
        },
        {
          id: 'create-alias',
          icon: '➕',
          title: 'Create Alias',
          description: 'Generate your own memorable 16-digit alias',
          bgColor: 'bg-yellow-100',
          iconBg: 'bg-yellow-500',
          status: 'available',
          version: '1.0.0',
          actionText: 'Create Now',
          actionLink: '#create',
          category: 'core',
        },
      ],
      categories: {
        core: 'Core Features',
      },
    };
  }
}

export const featuresService = new FeaturesService();
