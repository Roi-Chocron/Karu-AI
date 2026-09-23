import { Hono } from 'hono';
import { authenticateToken, requireAdmin } from './auth.js';
import { recordUserLog } from './logger.js';

export const postsApp = new Hono();

function formatPost(p) {
  let parsed = {};
  if (p.carousel_data) {
    try {
      parsed = typeof p.carousel_data === 'string' ? JSON.parse(p.carousel_data) : p.carousel_data;
    } catch (e) {}
  }
  return {
    id: p.id,
    user_id: p.user_id,
    username: p.username || 'Creator',
    title: p.title || parsed.title || 'Untitled',
    description: p.description || parsed.description || '',
    hashtags: p.hashtags || parsed.hashtags || '',
    likes_count: p.likes_count || 0,
    is_liked: p.is_liked || 0,
    is_shared: p.is_shared || 0,
    date: p.created_at ? new Date(p.created_at).toLocaleDateString('en-US') : 'Just now',
    created_at: p.created_at,
    tokens: {
      prompt: p.tokens_prompt || 1200,
      save: p.tokens_save || 600,
      autopost: p.tokens_autopost || 0
    },
    tokens_cost: (p.tokens_prompt || 1200) + (p.tokens_save || 600) + (p.tokens_autopost || 0),
    slides: parsed.slides || [],
    carousel_data: parsed
  };
}

// 1. GET ALL POSTS (ADMIN)
postsApp.get('/api/posts', requireAdmin, async (c) => {
  const db = c.env.DB;
  try {
    const { results } = await db.prepare(`
      SELECT id, user_id, username, title, description, hashtags,
             tokens_prompt, tokens_save, tokens_autopost, carousel_data, created_at,
             likes_count, is_liked, is_shared
      FROM posts ORDER BY created_at DESC
    `).all();
    return c.json((results || []).map(formatPost));
  } catch (err) {
    return c.json({ error: 'Failed to fetch posts' }, 500);
  }
});

// 2. GET CURRENT USER'S POSTS
postsApp.get('/api/posts/my', authenticateToken, async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  try {
    const { results } = await db.prepare(`
      SELECT id, user_id, username, title, description, hashtags,
             tokens_prompt, tokens_save, tokens_autopost, carousel_data, created_at,
             likes_count, is_liked, is_shared
      FROM posts WHERE user_id = ? ORDER BY created_at DESC
    `).bind(user.id).all();

    return c.json((results || []).map(formatPost));
  } catch (err) {
    console.error('Fetch my posts error:', err);
    return c.json({ error: 'Failed to fetch user posts' }, 500);
  }
});

// 3. GET COMMUNITY POSTS (PUBLIC)
postsApp.get('/api/posts/community', async (c) => {
  const db = c.env.DB;

  try {
    const { results } = await db.prepare(`
      SELECT id, user_id, username, title, description, hashtags,
             tokens_prompt, tokens_save, tokens_autopost, carousel_data, created_at,
             likes_count, is_liked, is_shared
      FROM posts WHERE is_shared = 1 ORDER BY created_at DESC LIMIT 50
    `).all();

    return c.json((results || []).map(formatPost));
  } catch (err) {
    console.error('Fetch community posts error:', err);
    return c.json({ error: 'Failed to fetch community posts' }, 500);
  }
});

// 4. GET PUBLIC POST BY ID
postsApp.get('/api/posts/public/:id', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;

  try {
    const post = await db.prepare(`
      SELECT id, user_id, username, title, description, hashtags,
             tokens_prompt, tokens_save, tokens_autopost, carousel_data, created_at,
             likes_count, is_liked, is_shared
      FROM posts WHERE id = ?
    `).bind(id).first();

    if (!post) {
      return c.json({ error: 'Post not found' }, 404);
    }

    return c.json(formatPost(post));
  } catch (err) {
    return c.json({ error: 'Error fetching post' }, 500);
  }
});

// 5. LIKE POST
postsApp.post('/api/posts/:id/like', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;

  try {
    const post = await db.prepare('SELECT likes_count FROM posts WHERE id = ?').bind(id).first();
    if (!post) return c.json({ error: 'Post not found' }, 404);

    const newLikes = (post.likes_count || 0) + 1;
    await db.prepare('UPDATE posts SET likes_count = ? WHERE id = ?').bind(newLikes, id).run();

    await recordUserLog(c, {
      action: 'post_like',
      level: 'INFO',
      message: `Post ${id} liked (Total: ${newLikes})`,
      statusCode: 200,
      details: { postId: id, likesCount: newLikes }
    });

    return c.json({ success: true, likes_count: newLikes });
  } catch (err) {
    return c.json({ error: 'Error updating likes' }, 500);
  }
});

// 6. TOGGLE SHARE COMMUNITY
postsApp.post('/api/posts/:id/share-community', authenticateToken, async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const db = c.env.DB;

  try {
    const post = await db.prepare('SELECT user_id, is_shared FROM posts WHERE id = ?').bind(id).first();
    if (!post) return c.json({ error: 'Post not found' }, 404);

    const isAdmin = (user.email === 'roi@karu.ai' || user.role === 'admin');
    const isOwner = (post.user_id === user.id || !post.user_id);
    if (!isOwner && !isAdmin) {
      return c.json({ error: 'You can only share your own posts' }, 403);
    }

    const newIsShared = post.is_shared ? 0 : 1;
    await db.prepare('UPDATE posts SET is_shared = ? WHERE id = ?').bind(newIsShared, id).run();

    await recordUserLog(c, {
      userId: user.id,
      username: user.username,
      action: 'post_share',
      level: 'INFO',
      message: `Community sharing for post ${id} was ${newIsShared ? 'enabled' : 'disabled'}`,
      statusCode: 200,
      details: { postId: id, isShared: !!newIsShared }
    });

    return c.json({ success: true, is_shared: newIsShared });
  } catch (err) {
    console.error('Share community error:', err);
    return c.json({ error: 'Error toggling community share' }, 500);
  }
});

// 7. SAVE NEW POST
postsApp.post('/api/posts', authenticateToken, async (c) => {
  const userPayload = c.get('user');
  const db = c.env.DB;
  const { title, description, hashtags, slides } = await c.req.json();

  if (!title || !slides || !Array.isArray(slides) || slides.length === 0) {
    return c.json({ error: 'Missing data for carousel creation' }, 400);
  }

  try {
    const user = await db.prepare('SELECT username, subscription, posts_left FROM users WHERE id = ?')
      .bind(userPayload.id).first();
    if (!user) return c.json({ error: 'User not found' }, 401);

    const isUnlimited = (user.subscription === 'agency' || user.subscription === 'unlimited');
    if (!isUnlimited && user.posts_left <= 0) {
      await recordUserLog(c, {
        userId: userPayload.id,
        username: user.username,
        action: 'quota_exceeded',
        level: 'WARN',
        message: `User ${user.username} tried saving post without remaining quota`,
        statusCode: 400,
        details: { postsLeft: user.posts_left, subscription: user.subscription }
      });
      return c.json({ error: 'You do not have enough remaining posts in your quota.' }, 400);
    }

    const postId = 'p_' + crypto.randomUUID().slice(0, 8);
    const tokensPrompt = Math.floor(1000 + Math.random() * 1000);
    const tokensSave = Math.floor(500 + Math.random() * 500);
    const tokensAutopost = 0;
    const carouselData = JSON.stringify({
      id: postId,
      author_name: user.username,
      created_at: new Date().toISOString(),
      description,
      hashtags,
      slides
    });

    if (!isUnlimited) {
      await db.prepare('UPDATE users SET posts_left = posts_left - 1 WHERE id = ?').bind(userPayload.id).run();
    }

    await db.prepare(`
      INSERT INTO posts (id, user_id, username, title, description, hashtags, tokens_prompt, tokens_save, tokens_autopost, carousel_data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(postId, userPayload.id, user.username, title, description || '', hashtags || '', tokensPrompt, tokensSave, tokensAutopost, carouselData).run();

    await recordUserLog(c, {
      userId: userPayload.id,
      username: user.username,
      action: 'post_create',
      level: 'INFO',
      message: `User saved carousel post: "${title}" (${slides.length} slides)`,
      statusCode: 200,
      details: { postId, title, slidesCount: slides.length, tokensPrompt, tokensSave }
    });

    return c.json({ success: true, postId });
  } catch (err) {
    console.error('Save post error:', err);
    await recordUserLog(c, {
      userId: userPayload.id,
      action: 'post_save_error',
      level: 'ERROR',
      message: `Error saving post: ${err.message}`,
      statusCode: 500,
      details: { error: err.message }
    });
    return c.json({ error: 'Error saving carousel post' }, 500);
  }
});

// 8. DELETE POST
postsApp.delete('/api/posts/:postId', authenticateToken, async (c) => {
  const postId = c.req.param('postId');
  const user = c.get('user');
  const db = c.env.DB;

  try {
    const post = await db.prepare('SELECT user_id, title FROM posts WHERE id = ?').bind(postId).first();
    if (!post) return c.json({ error: 'Post not found' }, 404);

    const isAdmin = (user.email === 'roi@karu.ai' || user.role === 'admin');
    if (post.user_id !== user.id && !isAdmin) {
      return c.json({ error: 'Not authorized to delete this post' }, 403);
    }

    await db.prepare('DELETE FROM posts WHERE id = ?').bind(postId).run();

    await recordUserLog(c, {
      userId: user.id,
      username: user.username,
      action: 'post_delete',
      level: 'INFO',
      message: `Deleted post: "${post.title || postId}" (${postId})`,
      statusCode: 200,
      details: { postId, title: post.title }
    });

    return c.json({ success: true, message: 'Post deleted successfully' });
  } catch (err) {
    return c.json({ error: 'Error deleting post' }, 500);
  }
});

// 9. GET CHAT HISTORY & ACTIVE CAROUSEL
postsApp.get('/api/posts/:postId/chat', authenticateToken, async (c) => {
  const postId = c.req.param('postId');
  const db = c.env.DB;

  try {
    const post = await db.prepare(`
      SELECT id, user_id, username, title, description, hashtags, tokens_prompt, tokens_save, tokens_autopost,
             carousel_data, created_at, likes_count, is_liked, is_shared, chat_history
      FROM posts WHERE id = ?
    `).bind(postId).first();
    if (!post) return c.json({ error: 'Post not found' }, 404);

    let chatHistory = [];
    if (post.chat_history) {
      try {
        chatHistory = JSON.parse(post.chat_history);
      } catch (e) {}
    }

    return c.json({
      success: true,
      chatHistory,
      carousel: formatPost(post)
    });
  } catch (err) {
    return c.json({ error: 'Error fetching chat history' }, 500);
  }
});
