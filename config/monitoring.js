const os = require('os');
const process = require('process');

class MonitoringService {
  constructor() {
    this.startTime = Date.now();
    this.requestCount = 0;
    this.errorCount = 0;
    this.responseTimeSum = 0;
    this.responseTimeCount = 0;
  }

  // Increment request counter
  incrementRequestCount() {
    this.requestCount++;
  }

  // Increment error counter
  incrementErrorCount() {
    this.errorCount++;
  }

  // Record response time
  recordResponseTime(duration) {
    this.responseTimeSum += duration;
    this.responseTimeCount++;
  }

  // Get system metrics
  getSystemMetrics() {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    return {
      system: {
        uptime: process.uptime(),
        loadAverage: os.loadavg(),
        totalMemory: os.totalmem(),
        freeMemory: os.freemem(),
        cpuCount: os.cpus().length,
        platform: os.platform(),
        arch: os.arch()
      },
      process: {
        pid: process.pid,
        uptime: process.uptime(),
        memory: {
          rss: memUsage.rss,
          heapTotal: memUsage.heapTotal,
          heapUsed: memUsage.heapUsed,
          external: memUsage.external,
          arrayBuffers: memUsage.arrayBuffers
        },
        cpu: {
          user: cpuUsage.user,
          system: cpuUsage.system
        }
      }
    };
  }

  // Get application metrics
  getApplicationMetrics() {
    const avgResponseTime = this.responseTimeCount > 0 
      ? this.responseTimeSum / this.responseTimeCount 
      : 0;

    return {
      requests: {
        total: this.requestCount,
        errors: this.errorCount,
        errorRate: this.requestCount > 0 ? (this.errorCount / this.requestCount) * 100 : 0
      },
      performance: {
        averageResponseTime: Math.round(avgResponseTime * 100) / 100,
        requestsPerSecond: this.requestCount / (process.uptime() || 1)
      },
      uptime: {
        startTime: this.startTime,
        uptime: Date.now() - this.startTime
      }
    };
  }

  // Get all metrics
  getAllMetrics() {
    return {
      timestamp: new Date().toISOString(),
      system: this.getSystemMetrics(),
      application: this.getApplicationMetrics()
    };
  }

  // Express middleware for monitoring
  middleware() {
    return (req, res, next) => {
      const start = Date.now();
      
      this.incrementRequestCount();
      
      res.on('finish', () => {
        const duration = Date.now() - start;
        this.recordResponseTime(duration);
        
        if (res.statusCode >= 400) {
          this.incrementErrorCount();
        }
      });
      
      next();
    };
  }

  // Health check with detailed status
  async getHealthStatus() {
    const metrics = this.getSystemMetrics();
    const appMetrics = this.getApplicationMetrics();
    
    // Define health thresholds
    const memoryUsagePercent = ((metrics.system.totalMemory - metrics.system.freeMemory) / metrics.system.totalMemory) * 100;
    const heapUsagePercent = (metrics.process.memory.heapUsed / metrics.process.memory.heapTotal) * 100;
    
    const status = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks: {
        memory: {
          status: memoryUsagePercent < 90 ? 'healthy' : 'warning',
          usage: `${memoryUsagePercent.toFixed(2)}%`,
          details: {
            total: Math.round(metrics.system.totalMemory / 1024 / 1024),
            free: Math.round(metrics.system.freeMemory / 1024 / 1024),
            used: Math.round((metrics.system.totalMemory - metrics.system.freeMemory) / 1024 / 1024)
          }
        },
        heap: {
          status: heapUsagePercent < 85 ? 'healthy' : 'warning',
          usage: `${heapUsagePercent.toFixed(2)}%`,
          details: {
            total: Math.round(metrics.process.memory.heapTotal / 1024 / 1024),
            used: Math.round(metrics.process.memory.heapUsed / 1024 / 1024)
          }
        },
        errorRate: {
          status: appMetrics.requests.errorRate < 5 ? 'healthy' : 'warning',
          rate: `${appMetrics.requests.errorRate.toFixed(2)}%`,
          details: {
            totalRequests: appMetrics.requests.total,
            totalErrors: appMetrics.requests.errors
          }
        },
        responseTime: {
          status: appMetrics.performance.averageResponseTime < 1000 ? 'healthy' : 'warning',
          average: `${appMetrics.performance.averageResponseTime}ms`
        }
      }
    };

    // Determine overall status
    const checkStatuses = Object.values(status.checks).map(check => check.status);
    if (checkStatuses.includes('unhealthy')) {
      status.status = 'unhealthy';
    } else if (checkStatuses.includes('warning')) {
      status.status = 'warning';
    }

    return status;
  }

  // Reset metrics (useful for testing)
  reset() {
    this.requestCount = 0;
    this.errorCount = 0;
    this.responseTimeSum = 0;
    this.responseTimeCount = 0;
    this.startTime = Date.now();
  }
}

// Export singleton instance
module.exports = new MonitoringService();