require('dotenv').config();

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const logger = require('./utils/logger');
const pool = require('./utils/db');

const app = express();
app.set('trust proxy', 1);

/**
 * Middleware
 */
app.use(
  cors({
    origin: function (origin, callback) {
      if (process.env.NODE_ENV === 'production') {
        callback(null, process.env.FRONTEND_URL || true);
      } else {
        callback(null, true);
      }
    },
    credentials: true
  })
);

app.use(express.json({ limit: '5mb' }));

/**
 * Request Logging
 */
app.use((req, res, next) => {
  const startedAt = Date.now();

  res.on('finish', () => {
    logger.info('HTTP request completed', {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
      ip: req.ip
    });
  });

  next();
});

/**
 * Rate Limiting
 */
app.use(
  '/api/auth',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20
  })
);

/**
 * Routes
 */
app.use('/api/auth', require('./routes/auth'));
app.use('/api/sessions', require('./routes/sessions'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/transactions', require('./routes/transactions'));
app.use('/api/users', require('./routes/users'));
app.use('/api/export', require('./routes/export'));

app.use('/api/agent', require('./routes/agent'));
app.use('/api/admin', require('./routes/admin'));

/**
 * Health Check
 */
app.get('/health', async (_, res) => {
  try {
    await pool.query('SELECT 1');

    res.json({
      status: 'ok',
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Health check failed', {
      error: error.message
    });

    res.status(500).json({
      status: 'error',
      database: 'disconnected'
    });
  }
});

/**
 * Start Server
 */
const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    const connection = await pool.getConnection();

    logger.info('Database connected successfully');

    connection.release();

    app.listen(PORT, '0.0.0.0', () => {
      logger.info('Server started', {
        port: PORT,
        environment: process.env.NODE_ENV || 'development'
      });
    });
  } catch (error) {
    logger.error('Database connection failed', {
      error: error.message
    });

    process.exit(1);
  }
}

/**
 * Graceful Shutdown
 */
process.on('SIGINT', async () => {
  logger.info('Shutting down server...');

  try {
    await pool.end();
    logger.info('Database pool closed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', {
      error: error.message
    });
    process.exit(1);
  }
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received');

  try {
    await pool.end();
    logger.info('Database pool closed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', {
      error: error.message
    });
    process.exit(1);
  }
});

startServer();