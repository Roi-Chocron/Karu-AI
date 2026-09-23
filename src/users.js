import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { setCookie, deleteCookie } from 'hono/cookie';
import { hashPassword, verifyPassword, authenticateToken, requireAdmin } from './auth.js';
import { recordUserLog } from './logger.js';

export const usersApp = new Hono();

// 1. SIGNUP
usersApp.post('/api/auth/signup', async (c) => {
  const { username, email, password } = await c.req.json();
  if (!username || !email || !password || password.length < 6) {
    await recordUserLog(c, {
      action: 'auth_signup_failed',
      level: 'WARN',
      message: 'Signup attempt with invalid input',
      statusCode: 400
    });
    return c.json({ error: 'Please fill in all required fields (password min 6 chars).' }, 400);
  }

  const db = c.env.DB;
  const cleanEmail = email.toLowerCase().trim();
  const cleanUsername = username.trim();

  try {
    const existing = await db.prepare('SELECT id FROM users WHERE email = ?').bind(cleanEmail).first();
    if (existing) {
      await recordUserLog(c, {
        action: 'auth_signup_failed',
        level: 'WARN',
        message: `Signup failed: email ${cleanEmail} already exists`,
        statusCode: 400,
        details: { email: cleanEmail }
      });
      return c.json({ error: 'This email address is already registered.' }, 400);
    }

    const userId = 'u_' + crypto.randomUUID().slice(0, 8);
    const hash = hashPassword(password);

    await db.prepare(`
      INSERT INTO users (id, username, email, password_hash, subscription, posts_left, role)
      VALUES (?, ?, ?, ?, 'free', 3, 'user')
    `).bind(userId, cleanUsername, cleanEmail, hash).run();

    const newUser = {
      id: userId,
      username: cleanUsername,
      email: cleanEmail,
      subscription: 'free',
      posts_left: 3,
      role: 'user'
    };

    const secret = c.env.JWT_SECRET || 'karu_ai_secure_jwt_secret_2026_key';
    const token = await sign({ id: userId, email: cleanEmail, role: 'user' }, secret, 'HS256');

    setCookie(c, 'authToken', token, {
      path: '/',
      maxAge: 864000,
      httpOnly: true,
      secure: true,
      sameSite: 'None'
    });

    await recordUserLog(c, {
      userId,
      username: cleanUsername,
      action: 'auth_signup',
      level: 'INFO',
      message: `New user registered: ${cleanUsername} (${cleanEmail})`,
      statusCode: 200,
      details: { email: cleanEmail, subscription: 'free', posts_left: 3 }
    });

    return c.json({ success: true, token, user: newUser });
  } catch (err) {
    console.error('Signup error:', err);
    await recordUserLog(c, {
      action: 'auth_signup_error',
      level: 'ERROR',
      message: `Registration server error for ${cleanEmail}: ${err.message}`,
      statusCode: 500,
      details: { error: err.message }
    });
    return c.json({ error: 'Internal server error during user registration.' }, 500);
  }
});

// 2. LOGIN
usersApp.post('/api/auth/login', async (c) => {
  const { email, password } = await c.req.json();
  if (!email || !password) {
    await recordUserLog(c, {
      action: 'auth_login_failed',
      level: 'WARN',
      message: 'Login attempt missing email or password',
      statusCode: 400
    });
    return c.json({ error: 'Please enter email and password.' }, 400);
  }

  const db = c.env.DB;
  const cleanEmail = email.toLowerCase().trim();

  try {
    const user = await db.prepare('SELECT * FROM users WHERE email = ?').bind(cleanEmail).first();
    if (!user) {
      await recordUserLog(c, {
        action: 'auth_login_failed',
        level: 'WARN',
        message: `Failed login attempt: user not found (${cleanEmail})`,
        statusCode: 400,
        details: { email: cleanEmail }
      });
      return c.json({ error: 'Incorrect login details.' }, 400);
    }

    const isValid = await verifyPassword(password, user.password_hash, user.id, db);
    if (!isValid) {
      await recordUserLog(c, {
        userId: user.id,
        username: user.username,
        action: 'auth_login_failed',
        level: 'WARN',
        message: `Failed login attempt: incorrect password for ${user.username} (${cleanEmail})`,
        statusCode: 400,
        details: { email: cleanEmail }
      });
      return c.json({ error: 'Incorrect login details.' }, 400);
    }

    const resUser = {
      id: user.id,
      username: user.username,
      email: user.email,
      subscription: user.subscription,
      posts_left: user.posts_left,
      role: user.role || 'user'
    };

    const secret = c.env.JWT_SECRET || 'karu_ai_secure_jwt_secret_2026_key';
    const token = await sign({ id: user.id, email: user.email, role: user.role || 'user' }, secret, 'HS256');

    setCookie(c, 'authToken', token, {
      path: '/',
      maxAge: 864000,
      httpOnly: true,
      secure: true,
      sameSite: 'None'
    });

    await recordUserLog(c, {
      userId: user.id,
      username: user.username,
      action: 'auth_login',
      level: 'INFO',
      message: `User logged in: ${user.username} (${user.email})`,
      statusCode: 200,
      details: { role: user.role || 'user', subscription: user.subscription }
    });

    return c.json({ success: true, token, user: resUser });
  } catch (err) {
    console.error('Login error:', err);
    await recordUserLog(c, {
      action: 'auth_login_error',
      level: 'ERROR',
      message: `Login server error for ${cleanEmail}: ${err.message}`,
      statusCode: 500,
      details: { error: err.message }
    });
    return c.json({ error: 'Internal server error during login.' }, 500);
  }
});

// 3. GET CURRENT USER
usersApp.get('/api/auth/me', authenticateToken, async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  try {
    const dbUser = await db.prepare(`
      SELECT id, username, email, subscription, posts_left, instagram_connected, preferred_time, phone, bio, role 
      FROM users WHERE id = ?
    `).bind(user.id).first();

    if (!dbUser) {
      return c.json({ error: 'User does not exist' }, 401);
    }

    return c.json(dbUser);
  } catch (err) {
    return c.json({ error: 'Failed to fetch user data' }, 500);
  }
});

// 4. LOGOUT
usersApp.post('/api/auth/logout', async (c) => {
  const user = c.get('user');
  await recordUserLog(c, {
    userId: user?.id,
    username: user?.username || user?.email,
    action: 'auth_logout',
    level: 'INFO',
    message: `User logged out: ${user?.username || user?.email || 'Anonymous'}`,
    statusCode: 200
  });

  deleteCookie(c, 'authToken', {
    path: '/',
    secure: true,
    sameSite: 'None'
  });
  return c.json({ success: true, message: 'Logged out successfully' });
});

// 5. UPDATE PROFILE
usersApp.post('/api/users/profile', authenticateToken, async (c) => {
  const user = c.get('user');
  const { phone, bio } = await c.req.json();
  const db = c.env.DB;

  try {
    await db.prepare('UPDATE users SET phone = ?, bio = ? WHERE id = ?')
      .bind(phone || '', bio || '', user.id)
      .run();

    await recordUserLog(c, {
      userId: user.id,
      action: 'profile_update',
      level: 'INFO',
      message: 'User updated profile details',
      statusCode: 200,
      details: { hasPhone: !!phone, hasBio: !!bio }
    });

    return c.json({ success: true, phone, bio });
  } catch (err) {
    return c.json({ error: 'Failed to update profile' }, 500);
  }
});

// 6. UPDATE INSTAGRAM STATUS
usersApp.post('/api/users/instagram', authenticateToken, async (c) => {
  const user = c.get('user');
  const { connected } = await c.req.json();
  const db = c.env.DB;

  try {
    await db.prepare('UPDATE users SET instagram_connected = ? WHERE id = ?')
      .bind(connected ? 1 : 0, user.id)
      .run();

    await recordUserLog(c, {
      userId: user.id,
      action: 'instagram_update',
      level: 'INFO',
      message: `Instagram connection toggled to: ${connected ? 'Connected' : 'Disconnected'}`,
      statusCode: 200,
      details: { connected: !!connected }
    });

    return c.json({ success: true, connected: !!connected });
  } catch (err) {
    return c.json({ error: 'Failed to update instagram status' }, 500);
  }
});

// 7. UPDATE TIME
usersApp.post('/api/users/time', authenticateToken, async (c) => {
  const user = c.get('user');
  const { time } = await c.req.json();
  const db = c.env.DB;

  try {
    await db.prepare('UPDATE users SET preferred_time = ? WHERE id = ?')
      .bind(time, user.id)
      .run();

    await recordUserLog(c, {
      userId: user.id,
      action: 'time_update',
      level: 'INFO',
      message: `Preferred publishing time updated to: ${time}`,
      statusCode: 200,
      details: { time }
    });

    return c.json({ success: true, time });
  } catch (err) {
    return c.json({ error: 'Failed to update preferred time' }, 500);
  }
});

// 8. ADMIN: LIST ALL USERS
usersApp.get('/api/users', requireAdmin, async (c) => {
  const db = c.env.DB;
  try {
    const { results } = await db.prepare(`
      SELECT id, username, email, subscription, posts_left, role, created_at, instagram_connected, preferred_time
      FROM users ORDER BY created_at DESC
    `).all();
    return c.json(results || []);
  } catch (err) {
    return c.json({ error: 'Failed to fetch users list' }, 500);
  }
});

// 9. ADMIN: UPDATE SUBSCRIPTION
usersApp.put('/api/users/:id/subscription', requireAdmin, async (c) => {
  const id = c.req.param('id');
  const adminUser = c.get('user');
  const { subscription } = await c.req.json();
  const db = c.env.DB;

  try {
    await db.prepare('UPDATE users SET subscription = ? WHERE id = ?').bind(subscription, id).run();

    await recordUserLog(c, {
      userId: id,
      action: 'admin_update_subscription',
      level: 'INFO',
      message: `Admin ${adminUser?.username || 'Admin'} updated subscription for user ${id} to "${subscription}"`,
      statusCode: 200,
      details: { targetUserId: id, subscription, updatedBy: adminUser?.email }
    });

    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: 'Failed to update subscription' }, 500);
  }
});

// 10. ADMIN: UPDATE ROLE
usersApp.put('/api/users/:id/role', requireAdmin, async (c) => {
  const id = c.req.param('id');
  const adminUser = c.get('user');
  const { role } = await c.req.json();
  const db = c.env.DB;

  try {
    await db.prepare('UPDATE users SET role = ? WHERE id = ?').bind(role, id).run();

    await recordUserLog(c, {
      userId: id,
      action: 'admin_update_role',
      level: 'INFO',
      message: `Admin ${adminUser?.username || 'Admin'} updated role for user ${id} to "${role}"`,
      statusCode: 200,
      details: { targetUserId: id, role, updatedBy: adminUser?.email }
    });

    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: 'Failed to update user role' }, 500);
  }
});

// 11. ADMIN: UPDATE POSTS LEFT
usersApp.put('/api/users/:id/posts-left', requireAdmin, async (c) => {
  const id = c.req.param('id');
  const adminUser = c.get('user');
  const { posts_left } = await c.req.json();
  const db = c.env.DB;

  try {
    await db.prepare('UPDATE users SET posts_left = ? WHERE id = ?').bind(posts_left, id).run();

    await recordUserLog(c, {
      userId: id,
      action: 'admin_update_posts_left',
      level: 'INFO',
      message: `Admin ${adminUser?.username || 'Admin'} updated remaining posts for user ${id} to ${posts_left}`,
      statusCode: 200,
      details: { targetUserId: id, posts_left, updatedBy: adminUser?.email }
    });

    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: 'Failed to update posts count' }, 500);
  }
});

// 12. ADMIN: DELETE USER
usersApp.delete('/api/users/:id', requireAdmin, async (c) => {
  const id = c.req.param('id');
  const currentAdmin = c.get('user');

  if (currentAdmin && currentAdmin.id === id) {
    return c.json({ error: 'לא ניתן למחוק את חשבון המנהל שמחובר כרגע.' }, 400);
  }

  const db = c.env.DB;
  try {
    // Delete user posts first (FK constraint)
    await db.prepare('DELETE FROM posts WHERE user_id = ?').bind(id).run();
    // Delete user
    const res = await db.prepare('DELETE FROM users WHERE id = ?').bind(id).run();

    await recordUserLog(c, {
      userId: id,
      action: 'admin_delete_user',
      level: 'WARN',
      message: `Admin ${currentAdmin?.username || 'Admin'} deleted user account: ${id}`,
      statusCode: 200,
      details: { deletedUserId: id, adminEmail: currentAdmin?.email }
    });

    return c.json({ success: true, message: 'המשתמש נמחק בהצלחה' });
  } catch (err) {
    console.error('Delete user error:', err);
    return c.json({ error: 'שגיאה במחיקת המשתמש: ' + err.message }, 500);
  }
});
