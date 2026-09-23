import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

import { usersApp } from './users.js';
import { postsApp } from './posts.js';
import { mediaApp } from './media.js';
import { aiApp } from './ai.js';
import { settingsApp } from './settings.js';
import { socialApp } from './social.js';
import { polarApp } from './polar.js';
import { logsApp } from './logs.js';
import { apiActivityLogger, recordUserLog } from './logger.js';

const app = new Hono();

// Global Middlewares
app.use('*', logger());
app.use('*', cors({
  origin: (origin) => origin || '*',
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  exposeHeaders: ['Content-Length', 'Set-Cookie'],
  credentials: true
}));

// Full User Activity Tracking Middleware on all API calls
app.use('/api/*', apiActivityLogger());

// Health & Info
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/info', (c) => {
  return c.json({
    name: 'Karu AI Cloudflare Fullstack',
    version: '2.0.0',
    status: 'healthy',
    edge: true,
    timestamp: new Date().toISOString()
  });
});

// Mount API Routes
app.route('/', usersApp);
app.route('/', postsApp);
app.route('/', mediaApp);
app.route('/', aiApp);
app.route('/', settingsApp);
app.route('/', socialApp);
app.route('/', polarApp);
app.route('/', logsApp);

// Static Assets fallback (Frontend serving)
app.get('*', async (c) => {
  if (c.env.ASSETS) {
    const res = await c.env.ASSETS.fetch(c.req.raw);
    if (res.status !== 404) {
      return res;
    }
  }
  return c.json({ error: 'Endpoint not found', path: c.req.path }, 404);
});

// Global Error Handler
app.onError(async (err, c) => {
  console.error('[Worker Error]', err);
  try {
    await recordUserLog(c, {
      action: 'server_error',
      level: 'ERROR',
      message: `Global error: ${err.message}`,
      statusCode: 500,
      details: { error: err.message, stack: err.stack }
    });
  } catch (e) {
    // Prevent recursive errors
  }
  return c.json({ error: 'Internal Server Error', message: err.message }, 500);
});

export default app;
