import { Hono } from 'hono';
import { requireAdmin } from './auth.js';
import { queryUserLogs, recordUserLog } from './logger.js';

export const logsApp = new Hono();

// 1. GET ALL SYSTEM LOGS (WITH ADVANCED FILTERS)
logsApp.get('/api/admin/logs', requireAdmin, async (c) => {
  const db = c.env.DB;
  const userId = c.req.query('user_id');
  const level = c.req.query('level');
  const action = c.req.query('action');
  const search = c.req.query('search');
  const limit = c.req.query('limit') || 100;
  const offset = c.req.query('offset') || 0;

  try {
    const result = await queryUserLogs(db, {
      userId,
      level,
      action,
      search,
      limit,
      offset
    });

    return c.json({
      success: true,
      ...result
    });
  } catch (err) {
    console.error('Error fetching admin logs:', err);
    return c.json({ error: 'Failed to fetch logs', message: err.message }, 500);
  }
});

// 2. GET LOGS FOR A SPECIFIC USER
logsApp.get('/api/users/:id/logs', requireAdmin, async (c) => {
  const db = c.env.DB;
  const userId = c.req.param('id');
  const level = c.req.query('level');
  const limit = c.req.query('limit') || 100;
  const offset = c.req.query('offset') || 0;

  try {
    const result = await queryUserLogs(db, {
      userId,
      level,
      limit,
      offset
    });

    return c.json({
      success: true,
      userId,
      ...result
    });
  } catch (err) {
    console.error(`Error fetching logs for user ${userId}:`, err);
    return c.json({ error: 'Failed to fetch user logs' }, 500);
  }
});

// 3. GET LOGS AGGREGATED STATS
logsApp.get('/api/admin/logs/stats', requireAdmin, async (c) => {
  const db = c.env.DB;
  try {
    const totalRow = await db.prepare('SELECT COUNT(*) as count FROM user_logs').first();
    const infoRow = await db.prepare("SELECT COUNT(*) as count FROM user_logs WHERE level = 'INFO'").first();
    const warnRow = await db.prepare("SELECT COUNT(*) as count FROM user_logs WHERE level = 'WARN'").first();
    const errorRow = await db.prepare("SELECT COUNT(*) as count FROM user_logs WHERE level = 'ERROR'").first();
    
    // Top 5 actions
    const { results: topActions } = await db.prepare(`
      SELECT action, COUNT(*) as count 
      FROM user_logs 
      GROUP BY action 
      ORDER BY count DESC 
      LIMIT 6
    `).all();

    return c.json({
      success: true,
      total: totalRow?.count || 0,
      levels: {
        info: infoRow?.count || 0,
        warn: warnRow?.count || 0,
        error: errorRow?.count || 0
      },
      topActions: topActions || []
    });
  } catch (err) {
    return c.json({ error: 'Failed to fetch logs stats' }, 500);
  }
});

// 4. CLEAR LOGS (ADMIN ONLY)
logsApp.delete('/api/admin/logs', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminUser = c.get('user');
  const userId = c.req.query('user_id');

  try {
    if (userId) {
      await db.prepare('DELETE FROM user_logs WHERE user_id = ?').bind(userId).run();
      await recordUserLog(c, {
        userId: adminUser?.id,
        username: adminUser?.username || adminUser?.email,
        action: 'admin_clear_user_logs',
        level: 'WARN',
        message: `Admin cleared logs for user ${userId}`,
        details: { targetUserId: userId }
      });
    } else {
      await db.prepare('DELETE FROM user_logs').run();
      await recordUserLog(c, {
        userId: adminUser?.id,
        username: adminUser?.username || adminUser?.email,
        action: 'admin_clear_all_logs',
        level: 'WARN',
        message: 'Admin purged all system logs'
      });
    }

    return c.json({ success: true, message: 'Logs cleared successfully' });
  } catch (err) {
    return c.json({ error: 'Failed to clear logs' }, 500);
  }
});
