import bcrypt from 'bcryptjs';
import { sign, verify } from 'hono/jwt';
import { getCookie } from 'hono/cookie';

export function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

export async function verifyPassword(password, storedHash, userId, db) {
  if (storedHash.startsWith('$2a$') || storedHash.startsWith('$2b$')) {
    return bcrypt.compareSync(password, storedHash);
  }
  
  // Legacy SHA-256 migration
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const shaHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  if (shaHash === storedHash) {
    const newHash = hashPassword(password);
    await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(newHash, userId).run();
    return true;
  }
  return false;
}

export async function authenticateToken(c, next) {
  let token = null;
  const authHeader = c.req.header('Authorization') || c.req.header('authorization');

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else {
    token = getCookie(c, 'authToken');
  }

  if (!token) {
    return c.json({ error: 'User not logged in' }, 401);
  }

  try {
    const secret = c.env.JWT_SECRET || 'karu_ai_secure_jwt_secret_2026_key';
    const decoded = await verify(token, secret, 'HS256');
    c.set('user', decoded);
    return await next();
  } catch (err) {
    console.error('JWT verify error:', err);
    return c.json({ error: 'Invalid or expired authentication token' }, 401);
  }
}

export async function requireAdmin(c, next) {
  let token = null;
  const authHeader = c.req.header('Authorization') || c.req.header('authorization');

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else {
    token = getCookie(c, 'authToken');
  }

  if (!token) {
    return c.json({ error: 'User not logged in' }, 401);
  }

  try {
    const secret = c.env.JWT_SECRET || 'karu_ai_secure_jwt_secret_2026_key';
    const decoded = await verify(token, secret, 'HS256');
    const db = c.env.DB;
    
    let dbUser = null;
    if (decoded.id) {
      dbUser = await db.prepare('SELECT id, email, role FROM users WHERE id = ?').bind(decoded.id).first();
    }
    if (!dbUser && decoded.email) {
      dbUser = await db.prepare('SELECT id, email, role FROM users WHERE LOWER(email) = LOWER(?)').bind(decoded.email).first();
    }

    const emailMatch = (dbUser?.email && dbUser.email.toLowerCase() === 'roi@karu.ai') ||
                       (decoded?.email && decoded.email.toLowerCase() === 'roi@karu.ai');
    const roleMatch = dbUser?.role === 'admin' || decoded?.role === 'admin';

    if (roleMatch || emailMatch) {
      decoded.role = 'admin';
      c.set('user', decoded);
      return await next();
    } else {
      return c.json({ error: 'Forbidden: Admin access required.' }, 403);
    }
  } catch (err) {
    console.error('requireAdmin error:', err);
    return c.json({ error: 'Invalid or expired authentication token' }, 401);
  }
}
