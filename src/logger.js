import { decode } from 'hono/jwt';
import { getCookie } from 'hono/cookie';

/**
 * Extract client IP from Cloudflare or proxy headers
 */
export function extractClientIp(c) {
  return c.req.header('cf-connecting-ip') ||
         c.req.header('x-real-ip') ||
         c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
         '127.0.0.1';
}

/**
 * Extract user information from context or authorization token
 */
export function extractUserFromReq(c) {
  const user = c.get('user');
  if (user) return user;

  try {
    const authHeader = c.req.header('Authorization') || c.req.header('authorization');
    let token = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else {
      token = getCookie(c, 'authToken');
    }

    if (token) {
      const { payload } = decode(token);
      return payload || null;
    }
  } catch (e) {
    // Ignore decode errors
  }
  return null;
}

/**
 * Core function to record an activity log in D1 and console
 */
export async function recordUserLog(c, {
  userId = null,
  username = null,
  action = 'api_call',
  level = 'INFO',
  message = '',
  method = null,
  path = null,
  statusCode = null,
  ip = null,
  userAgent = null,
  durationMs = null,
  details = null
} = {}) {
  const db = c.env?.DB;
  if (!db) {
    console.warn('[Logger] No DB binding found on c.env');
    return null;
  }

  const reqUser = extractUserFromReq(c);
  const finalUserId = userId || reqUser?.id || null;
  const finalUsername = username || reqUser?.username || reqUser?.email || (finalUserId ? `User (${finalUserId})` : 'Guest');
  const finalMethod = method || c.req?.method || 'UNKNOWN';
  const finalPath = path || c.req?.path || '/';
  const finalIp = ip || extractClientIp(c);
  const finalUserAgent = userAgent || c.req?.header('user-agent') || '';
  const finalStatus = statusCode ?? (c.res?.status || 200);
  const finalLevel = (level || 'INFO').toUpperCase();

  const logId = 'log_' + Date.now().toString(36) + '_' + crypto.randomUUID().slice(0, 6);

  let detailsStr = null;
  if (details) {
    detailsStr = typeof details === 'object' ? JSON.stringify(details) : String(details);
  }

  // Mark on context that a custom log was recorded for this request
  if (typeof c.set === 'function') {
    c.set('customLogRecorded', true);
  }

  console.log(`[UserLog] [${finalLevel}] [${finalUsername}|${action}] ${message || finalPath}`);

  const writePromise = (async () => {
    try {
      await db.prepare(`
        INSERT INTO user_logs (
          id, user_id, username, action, level, message,
          method, path, status_code, ip, user_agent, duration_ms, details
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        logId,
        finalUserId,
        finalUsername,
        action,
        finalLevel,
        message || `${finalMethod} ${finalPath}`,
        finalMethod,
        finalPath,
        finalStatus,
        finalIp,
        finalUserAgent,
        durationMs,
        detailsStr
      ).run();
    } catch (err) {
      console.error('[Logger DB Error] Failed to write log:', err);
    }
  })();

  if (c.executionCtx && typeof c.executionCtx.waitUntil === 'function') {
    c.executionCtx.waitUntil(writePromise);
  } else {
    await writePromise;
  }

  return logId;
}

/**
 * Hono Middleware: Automatically tracks all user API requests
 */
export function apiActivityLogger() {
  return async (c, next) => {
    const path = c.req.path;

    // Skip static assets, health checks, binary media serving, and logs API to avoid loops
    if (
      c.req.method === 'OPTIONS' ||
      path === '/api/health' ||
      path.startsWith('/api/admin/logs') ||
      path.startsWith('/api/media/') ||
      !path.startsWith('/api/')
    ) {
      return await next();
    }

    const start = performance.now();
    try {
      await next();
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      await recordUserLog(c, {
        action: 'server_exception',
        level: 'ERROR',
        message: `Unhandled exception on ${c.req.method} ${path}: ${err.message}`,
        statusCode: 500,
        durationMs,
        details: { error: err.message, stack: err.stack }
      });
      throw err;
    }

    const durationMs = Math.round(performance.now() - start);
    const alreadyLogged = c.get('customLogRecorded');
    const status = c.res ? c.res.status : 200;

    // If no custom log was triggered inside route handler, record an API request log
    if (!alreadyLogged) {
      let level = 'INFO';
      if (status >= 500) level = 'ERROR';
      else if (status >= 400) level = 'WARN';

      const reqUser = extractUserFromReq(c);
      const userLabel = reqUser?.username || reqUser?.email || (reqUser?.id ? `User ${reqUser.id}` : 'Guest');

      await recordUserLog(c, {
        action: 'api_request',
        level,
        message: `${c.req.method} ${path} (${status}) - ${userLabel}`,
        statusCode: status,
        durationMs
      });
    }
  };
}

/**
 * Query logs with filters, pagination, and total count
 */
export async function queryUserLogs(db, {
  userId = null,
  level = null,
  action = null,
  search = null,
  limit = 50,
  offset = 0
} = {}) {
  const whereClauses = [];
  const bindings = [];

  if (userId && userId !== 'ALL') {
    whereClauses.push('user_id = ?');
    bindings.push(userId);
  }

  if (level && level !== 'ALL') {
    whereClauses.push('level = ?');
    bindings.push(level.toUpperCase());
  }

  if (action && action !== 'ALL') {
    whereClauses.push('action = ?');
    bindings.push(action);
  }

  if (search && search.trim()) {
    const q = `%${search.trim()}%`;
    whereClauses.push('(message LIKE ? OR username LIKE ? OR path LIKE ? OR details LIKE ? OR ip LIKE ?)');
    bindings.push(q, q, q, q, q);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  // Get total count
  const countSql = `SELECT COUNT(*) as total FROM user_logs ${whereSql}`;
  const countRes = await db.prepare(countSql).bind(...bindings).first();
  const total = countRes?.total || 0;

  // Get records
  const safeLimit = Math.min(Math.max(1, parseInt(limit) || 50), 500);
  const safeOffset = Math.max(0, parseInt(offset) || 0);

  const querySql = `
    SELECT id, user_id, username, action, level, message,
           method, path, status_code, ip, user_agent, duration_ms, details, created_at
    FROM user_logs
    ${whereSql}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `;
  const listBindings = [...bindings, safeLimit, safeOffset];
  const { results } = await db.prepare(querySql).bind(...listBindings).all();

  const formatted = (results || []).map(row => {
    let parsedDetails = row.details;
    if (row.details && typeof row.details === 'string') {
      try {
        parsedDetails = JSON.parse(row.details);
      } catch (e) {
        // Keep as string
      }
    }
    return {
      ...row,
      details: parsedDetails,
      time: row.created_at ? new Date(row.created_at).toLocaleTimeString('he-IL', { hour12: false }) : ''
    };
  });

  return {
    total,
    limit: safeLimit,
    offset: safeOffset,
    logs: formatted
  };
}
