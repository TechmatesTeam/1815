import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { config } from '@/config/environment';
import { connectDatabase } from '@/config/database';
import { connectRedis } from '@/config/redis';
import { logger } from '@/utils/logger';
import { errorHandler } from '@/middlewares/errorHandler';
import { requestLogger } from '@/middlewares/requestLogger';
import { rateLimiter } from '@/middlewares/rateLimiter';
import { requestId } from '@/middlewares/validation';
import { compressionMiddleware, compressionHeaders } from '@/middlewares/compression';
import { apiRoutes } from '@/routes';
import { cacheWarmingJob } from '@/jobs/cacheWarmingJob';

const app = express();

// Security middleware
app.use(helmet());
app.use(cors(config.cors));

// Performance middleware - Enhanced compression with proper headers
app.use(compressionHeaders);
app.use(compressionMiddleware);

// Rate limiting
app.use(rateLimiter);

// Request parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request ID generation (must be before logging)
app.use(requestId);

// Logging
app.use(requestLogger);

// API routes
app.use('/api/v1', apiRoutes);

// Simple MongoDB viewer route
app.get('/dbviewer', (req, res) => {
  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MongoDB Viewer - 1815_dev Database</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace; background: #1a1a1a; color: #e0e0e0; line-height: 1.6; }
        .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; border-radius: 10px; margin-bottom: 20px; text-align: center; }
        .header h1 { color: white; font-size: 2em; margin-bottom: 10px; }
        .status { display: inline-block; padding: 5px 15px; border-radius: 20px; font-size: 0.9em; font-weight: bold; }
        .status.connected { background: #4caf50; color: white; }
        .status.error { background: #f44336; color: white; }
        .controls { background: #2d2d2d; padding: 20px; border-radius: 10px; margin-bottom: 20px; display: flex; gap: 10px; flex-wrap: wrap; }
        button { padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; font-family: inherit; font-size: 0.9em; transition: all 0.3s; }
        button.primary { background: #2196f3; color: white; }
        button.success { background: #4caf50; color: white; }
        button.warning { background: #ff9800; color: white; }
        button.danger { background: #f44336; color: white; }
        button:hover { transform: translateY(-2px); box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3); }
        .content { background: #2d2d2d; padding: 20px; border-radius: 10px; min-height: 400px; }
        .loading { text-align: center; padding: 50px; color: #888; }
        .alias-item { background: #3d3d3d; margin: 10px 0; padding: 15px; border-radius: 8px; border-left: 4px solid #4caf50; }
        .field { margin: 5px 0; }
        .field-label { color: #888; font-size: 0.9em; }
        .field-value { color: #e0e0e0; font-weight: bold; }
        .address { font-family: 'Monaco', monospace; font-size: 0.8em; background: #1a1a1a; padding: 5px; border-radius: 3px; word-break: break-all; }
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin: 20px 0; }
        .stat-card { background: #3d3d3d; padding: 20px; border-radius: 8px; text-align: center; }
        .stat-number { font-size: 2em; font-weight: bold; color: #2196f3; }
        .stat-label { color: #888; margin-top: 5px; }
        .search-box { width: 100%; padding: 10px; margin: 10px 0; background: #1a1a1a; border: 1px solid #555; border-radius: 5px; color: #e0e0e0; font-family: inherit; }
        .error { color: #f44336; background: #2d1b1b; padding: 10px; border-radius: 5px; margin: 10px 0; }
        .success { color: #4caf50; background: #1b2d1b; padding: 10px; border-radius: 5px; margin: 10px 0; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🍃 MongoDB Viewer</h1>
            <div id="connectionStatus" class="status connected">✅ Connected</div>
        </div>
        <div class="controls">
            <button class="success" onclick="loadAliases()">🔗 View Aliases</button>
            <button class="primary" onclick="loadStats()">📊 Statistics</button>
            <button class="primary" onclick="showSearch()">🔍 Search Alias</button>
            <button class="danger" onclick="clearContent()">🗑️ Clear</button>
        </div>
        <div class="content">
            <div id="searchSection" style="display: none;">
                <input type="text" id="searchInput" class="search-box" placeholder="Enter alias short code to search...">
                <button class="primary" onclick="searchAlias()">🔍 Search</button>
            </div>
            <div id="content">
                <div class="loading">Welcome to MongoDB Viewer! Select an option above to get started.</div>
            </div>
        </div>
    </div>
    <script>
        function showError(message) {
            document.getElementById('content').innerHTML = \`<div class="error">❌ \${message}</div>\`;
        }
        function showSuccess(message) {
            document.getElementById('content').innerHTML = \`<div class="success">✅ \${message}</div>\`;
        }
        function showLoading(message = 'Loading...') {
            document.getElementById('content').innerHTML = \`<div class="loading">\${message}</div>\`;
        }
        function clearContent() {
            document.getElementById('content').innerHTML = '<div class="loading">Content cleared. Select an option above.</div>';
            document.getElementById('searchSection').style.display = 'none';
        }
        function showSearch() {
            document.getElementById('searchSection').style.display = 'block';
            document.getElementById('content').innerHTML = '<div class="loading">Enter a short code above to search for an alias.</div>';
        }
        async function loadAliases() {
            showLoading('Loading aliases...');
            try {
                const response = await fetch('/api/v1/web-viewer/aliases');
                const data = await response.json();
                if (data.success) {
                    let content = '<h2>🔗 All Aliases</h2>';
                    data.data.aliases.forEach(alias => {
                        content += \`
                            <div class="alias-item">
                                <div class="field"><div class="field-label">Short Code:</div><div class="field-value">\${alias.shortCode}</div></div>
                                <div class="field"><div class="field-label">Cardano Address:</div><div class="address">\${alias.cardanoAddress}</div></div>
                                <div class="field"><div class="field-label">Custom Name:</div><div class="field-value">\${alias.customName || 'None'}</div></div>
                                <div class="field"><div class="field-label">Use Count:</div><div class="field-value">\${alias.useCount}</div></div>
                                <div class="field"><div class="field-label">Status:</div><div class="field-value">\${alias.isActive ? '✅ Active' : '❌ Inactive'}</div></div>
                                <div class="field"><div class="field-label">Expires At:</div><div class="field-value">\${new Date(alias.expiresAt).toLocaleString()}</div></div>
                            </div>
                        \`;
                    });
                    document.getElementById('content').innerHTML = content;
                } else {
                    showError('Failed to load aliases');
                }
            } catch (error) {
                showError('Failed to connect to database');
            }
        }
        async function loadStats() {
            showLoading('Loading statistics...');
            try {
                const response = await fetch('/api/v1/web-viewer/stats');
                const data = await response.json();
                if (data.success) {
                    document.getElementById('content').innerHTML = \`
                        <h2>📊 Database Statistics</h2>
                        <div class="stats-grid">
                            <div class="stat-card"><div class="stat-number">\${data.data.aliasCount}</div><div class="stat-label">Total Aliases</div></div>
                            <div class="stat-card"><div class="stat-number">\${data.data.userCount}</div><div class="stat-label">Users</div></div>
                            <div class="stat-card"><div class="stat-number">\${data.data.searchHistoryCount}</div><div class="stat-label">Search History</div></div>
                            <div class="stat-card"><div class="stat-number">\${data.data.dataSizeMB} MB</div><div class="stat-label">Data Size</div></div>
                        </div>
                        <div class="field"><div class="field-label">Database:</div><div class="field-value">\${data.data.database}</div></div>
                        <div class="field"><div class="field-label">Collections:</div><div class="field-value">\${data.data.collections}</div></div>
                        <div class="field"><div class="field-label">Total Objects:</div><div class="field-value">\${data.data.objects}</div></div>
                    \`;
                } else {
                    showError('Failed to load statistics');
                }
            } catch (error) {
                showError('Failed to connect to database');
            }
        }
        async function searchAlias() {
            const shortCode = document.getElementById('searchInput').value.trim();
            if (!shortCode) {
                showError('Please enter a short code to search');
                return;
            }
            showLoading(\`Searching for alias: \${shortCode}\`);
            try {
                const response = await fetch(\`/api/v1/resolve/\${shortCode}\`);
                const data = await response.json();
                if (data.success) {
                    document.getElementById('content').innerHTML = \`
                        <h2>🔍 Search Result</h2>
                        <div class="alias-item">
                            <div class="field"><div class="field-label">Short Code:</div><div class="field-value">\${shortCode}</div></div>
                            <div class="field"><div class="field-label">Cardano Address:</div><div class="address">\${data.data.cardanoAddress}</div></div>
                            <div class="field"><div class="field-label">Custom Name:</div><div class="field-value">\${data.data.customName || 'None'}</div></div>
                            <div class="field"><div class="field-label">Use Count:</div><div class="field-value">\${data.data.useCount}</div></div>
                            <div class="field"><div class="field-label">Expires At:</div><div class="field-value">\${new Date(data.data.expiresAt).toLocaleString()}</div></div>
                        </div>
                    \`;
                } else {
                    showError(\`Alias not found: \${shortCode}\`);
                }
            } catch (error) {
                showError(\`Search failed: \${error.message}\`);
            }
        }
        document.addEventListener('DOMContentLoaded', function() {
            document.getElementById('searchInput')?.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') searchAlias();
            });
        });
    </script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html');
  res.send(htmlContent);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    data: {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
    },
  });
});

// Error handling
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: 'Endpoint not found',
    },
    metadata: {
      timestamp: new Date().toISOString(),
      requestId: res.locals.requestId,
      version: process.env.npm_package_version || '1.0.0',
    },
  });
});

async function startServer(): Promise<void> {
  try {
    // Try to connect to databases, but don't fail if they're not available
    try {
      await connectDatabase();
      logger.info('✅ Database connected');
    } catch (error) {
      logger.warn('⚠️  Database not available, running in mock mode');
    }

    // Try to connect to Redis in the background, don't wait for it
    connectRedis()
      .then(() => {
        logger.info('✅ Redis connected');
        // Start cache warming job after Redis connection
        cacheWarmingJob.start(60); // Run every 60 minutes
      })
      .catch(() => logger.warn('⚠️  Redis not available, running in mock mode'));

    // Start server regardless of database connections
    const port = config.port;
    app.listen(port, () => {
      logger.info(`🚀 Server running on port ${port}`);
      logger.info(`📊 Environment: ${config.nodeEnv}`);
      logger.info(`🔗 API Base URL: http://localhost:${port}/api/v1`);
      logger.info(`🔧 Mode: ${mongoose.connection.readyState === 1 ? 'Full' : 'Mock'}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  cacheWarmingJob.stop();
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  cacheWarmingJob.stop();
  process.exit(0);
});

// Start the server
startServer().catch(error => {
  logger.error('Unhandled error during server startup:', error);
  process.exit(1);
});
