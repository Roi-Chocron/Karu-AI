import { Hono } from 'hono';
import { authenticateToken } from './auth.js';
import { recordUserLog } from './logger.js';

export const socialApp = new Hono();

const GRAPH_VERSION = 'v19.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

// 1. GET SOCIAL STATUS
socialApp.get('/api/social/status', authenticateToken, async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  try {
    const dbUser = await db.prepare('SELECT instagram_connected FROM users WHERE id = ?').bind(user.id).first();
    const token = c.env.FB_ACCESS_TOKEN;
    const igAccountId = c.env.INSTAGRAM_ACCOUNT_ID || '17841475705860104';

    return c.json({
      connected: !!dbUser?.instagram_connected || !!token,
      instagramAccountId: igAccountId,
      facebookPageId: c.env.FACEBOOK_PAGE_ID || '1325245597340956'
    });
  } catch (err) {
    return c.json({ error: 'Failed to fetch social status' }, 500);
  }
});

// 2. DISCONNECT
socialApp.post('/api/social/disconnect', authenticateToken, async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  try {
    await db.prepare('UPDATE users SET instagram_connected = 0 WHERE id = ?').bind(user.id).run();
    return c.json({ success: true, message: 'Disconnected successfully' });
  } catch (err) {
    return c.json({ error: 'Failed to disconnect' }, 500);
  }
});

// 3. PUBLISH TO INSTAGRAM
socialApp.post('/api/social/publish-instagram', authenticateToken, async (c) => {
  const { imageUrl, caption } = await c.req.json();
  if (!imageUrl) {
    return c.json({ error: 'Image URL is required' }, 400);
  }

  const token = c.env.FB_ACCESS_TOKEN;
  const igAccountId = c.env.INSTAGRAM_ACCOUNT_ID || '17841475705860104';

  if (!token) {
    return c.json({ error: 'FB_ACCESS_TOKEN is not configured in Cloudflare environment' }, 400);
  }

  try {
    // Step 1: Create media container
    const containerRes = await fetch(`${GRAPH_BASE}/${igAccountId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_url: imageUrl,
        caption: caption || '',
        access_token: token
      })
    });
    const containerData = await containerRes.json();
    if (!containerRes.ok || containerData.error) {
      return c.json({ error: containerData.error?.message || 'Failed to create Instagram container' }, 400);
    }

    const creationId = containerData.id;

    // Step 2: Publish media
    const publishRes = await fetch(`${GRAPH_BASE}/${igAccountId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id: creationId,
        access_token: token
      })
    });
    const publishData = await publishRes.json();
    if (!publishRes.ok || publishData.error) {
      return c.json({ error: publishData.error?.message || 'Failed to publish media' }, 400);
    }

    await recordUserLog(c, {
      action: 'social_publish_instagram',
      level: 'INFO',
      message: `Published post to Instagram (Post ID: ${publishData.id})`,
      statusCode: 200,
      details: { igPostId: publishData.id, imageUrl }
    });

    return c.json({ success: true, postId: publishData.id });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// 4. PUBLISH TO FACEBOOK
socialApp.post('/api/social/publish-facebook', authenticateToken, async (c) => {
  const { imageUrl, message } = await c.req.json();
  const token = c.env.FB_ACCESS_TOKEN;
  const pageId = c.env.FACEBOOK_PAGE_ID || '1325245597340956';

  if (!token) {
    return c.json({ error: 'FB_ACCESS_TOKEN is not configured' }, 400);
  }

  try {
    const endpoint = imageUrl
      ? `${GRAPH_BASE}/${pageId}/photos`
      : `${GRAPH_BASE}/${pageId}/feed`;

    const body = imageUrl
      ? { url: imageUrl, caption: message || '', access_token: token }
      : { message: message || '', access_token: token };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      return c.json({ error: data.error?.message || 'Failed to publish to Facebook' }, 400);
    }

    await recordUserLog(c, {
      action: 'social_publish_facebook',
      level: 'INFO',
      message: `Published post to Facebook Page (ID: ${data.id || data.post_id})`,
      statusCode: 200,
      details: { fbPostId: data.id || data.post_id }
    });

    return c.json({ success: true, postId: data.id || data.post_id });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});
