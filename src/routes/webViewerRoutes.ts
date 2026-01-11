import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';

const router = Router();

/**
 * Serve MongoDB Web Viewer
 * GET /api/v1/web-viewer/mongodb
 */
router.get('/mongodb', (req: Request, res: Response): void => {
  try {
    const htmlPath = path.join(__dirname, '../../mongodb-web-viewer.html');

    // Check if file exists
    if (!fs.existsSync(htmlPath)) {
      res.status(404).json({
        success: false,
        error: {
          code: 'FILE_NOT_FOUND',
          message: 'MongoDB web viewer file not found',
        },
      });
      return;
    }

    // Read and serve the HTML file
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');

    // Set appropriate headers
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 'no-cache');

    // Send the HTML content
    res.send(htmlContent);
  } catch (error) {
    console.error('Error serving MongoDB web viewer:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to serve MongoDB web viewer',
      },
    });
  }
});

/**
 * API endpoint to get database collections info
 * GET /api/v1/web-viewer/collections
 */
router.get('/collections', async (req: Request, res: Response) => {
  try {
    const { MongoClient } = require('mongodb');
    const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/1815_dev';
    const client = new MongoClient(uri);

    await client.connect();
    const db = client.db('1815_dev');

    // Get collections info
    const collections = await db.listCollections().toArray();
    const collectionsInfo = [];

    for (const collection of collections) {
      const count = await db.collection(collection.name).countDocuments();
      collectionsInfo.push({
        name: collection.name,
        count: count,
        type: collection.type || 'collection',
      });
    }

    await client.close();

    res.json({
      success: true,
      data: {
        database: '1815_dev',
        collections: collectionsInfo,
        totalCollections: collectionsInfo.length,
        totalDocuments: collectionsInfo.reduce((sum, col) => sum + col.count, 0),
      },
    });
  } catch (error) {
    console.error('Error getting collections info:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: 'Failed to get collections information',
      },
    });
  }
});

/**
 * API endpoint to get aliases data for web viewer
 * GET /api/v1/web-viewer/aliases
 */
router.get('/aliases', async (req: Request, res: Response) => {
  try {
    const { MongoClient } = require('mongodb');
    const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/1815_dev';
    const client = new MongoClient(uri);

    await client.connect();
    const db = client.db('1815_dev');

    // Get all aliases
    const aliases = await db.collection('aliases').find({}).toArray();

    // Format aliases for web viewer
    const formattedAliases = aliases.map((alias: any) => ({
      shortCode: alias.shortCode,
      cardanoAddress: alias.cardanoAddress,
      customName: alias.customName || null,
      isActive: alias.isActive,
      useCount: alias.useCount || 0,
      expiresAt: alias.expiresAt,
      createdAt: alias.createdAt,
      lastUsedAt: alias.lastUsedAt || null,
    }));

    await client.close();

    res.json({
      success: true,
      data: {
        aliases: formattedAliases,
        totalAliases: formattedAliases.length,
        activeAliases: formattedAliases.filter(
          (a: any) => a.isActive && new Date(a.expiresAt) > new Date()
        ).length,
        expiredAliases: formattedAliases.filter(
          (a: any) => !a.isActive || new Date(a.expiresAt) <= new Date()
        ).length,
      },
    });
  } catch (error) {
    console.error('Error getting aliases data:', error);
    // Return mock data when database is not available
    const mockAliases = [
      {
        shortCode: '4243178751001758',
        cardanoAddress:
          'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj0vs2f6jvgtqx86hqe5syy6t',
        customName: 'Test Wallet 1',
        isActive: true,
        useCount: 5,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        createdAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
      },
      {
        shortCode: '1760414018001297',
        cardanoAddress:
          'addr1qy8ac7qqy0vtulyl7wntmsxc6wex80gvcyjy33qffrhm7sh927ysx5sftuw0dlpdt3k6cwng5pxj3jhsydsyer3jcu5d8ps7zex2k2xt3uqxgjqnnj0vs2f6jvgtqx86hqe5syy6t',
        customName: 'Test Wallet 2',
        isActive: true,
        useCount: 3,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        createdAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
      },
      {
        shortCode: '6273358125001101',
        cardanoAddress:
          'addr1qxqs6qkr6c6hfhcvll68emkdv87tmky3rjy33qffrhm7sh927ysx5sftuw0dlpdt3k6cwng5pxj3jhsydsyer3jcu5d8ps7zex2k2xt3uqxgjqnnj0vs2f6jvgtqx86hqe5syy6t',
        customName: 'Test Wallet 3',
        isActive: true,
        useCount: 1,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        createdAt: new Date().toISOString(),
        lastUsedAt: null,
      },
    ];

    res.json({
      success: true,
      data: {
        aliases: mockAliases,
        totalAliases: mockAliases.length,
        activeAliases: mockAliases.filter(a => a.isActive).length,
        expiredAliases: 0,
      },
    });
  }
});

/**
 * API endpoint to get database statistics
 * GET /api/v1/web-viewer/stats
 */
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const { MongoClient } = require('mongodb');
    const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/1815_dev';
    const client = new MongoClient(uri);

    await client.connect();
    const db = client.db('1815_dev');

    // Get database stats
    const stats = await db.stats();

    // Get collection counts
    const aliasCount = await db.collection('aliases').countDocuments();
    const userCount = await db.collection('users').countDocuments();
    const searchHistoryCount = await db.collection('searchhistories').countDocuments();

    await client.close();

    res.json({
      success: true,
      data: {
        database: stats.db,
        collections: stats.collections,
        objects: stats.objects,
        dataSize: stats.dataSize,
        storageSize: stats.storageSize,
        indexes: stats.indexes,
        aliasCount,
        userCount,
        searchHistoryCount,
        dataSizeMB: (stats.dataSize / 1024 / 1024).toFixed(2),
        storageSizeMB: (stats.storageSize / 1024 / 1024).toFixed(2),
      },
    });
  } catch (error) {
    console.error('Error getting database stats:', error);
    // Return mock data when database is not available
    res.json({
      success: true,
      data: {
        database: '1815_dev',
        collections: 3,
        objects: 3,
        dataSize: 1024,
        storageSize: 2048,
        indexes: 3,
        aliasCount: 3,
        userCount: 0,
        searchHistoryCount: 0,
        dataSizeMB: '0.00',
        storageSizeMB: '0.00',
      },
    });
  }
});

export { router as webViewerRoutes };
