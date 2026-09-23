import { Hono } from 'hono';
import { authenticateToken } from './auth.js';
import { recordUserLog } from './logger.js';

export const polarApp = new Hono();

// Plan quotas definition
const PLAN_CONFIG = {
  free: { name: 'Free Plan', posts: 3, price: 0 },
  basic: { name: 'Basic Plan', posts: 30, price: 9 },
  pro: { name: 'Pro Plan', posts: 60, price: 19 },
  agency: { name: 'VIP Plan', posts: 100, price: 39 }
};

function getPolarConfig(env) {
  const isProd = (env.POLAR_ENVIRONMENT || 'sandbox').toLowerCase() === 'production';
  return {
    accessToken: env.POLAR_ACCESS_TOKEN || '',
    webhookSecret: env.POLAR_WEBHOOK_SECRET || '',
    environment: isProd ? 'production' : 'sandbox',
    apiBase: isProd ? 'https://api.polar.sh/v1' : 'https://sandbox-api.polar.sh/v1',
    products: {
      basic: env.POLAR_PRODUCT_BASIC_ID || '',
      pro: env.POLAR_PRODUCT_PRO_ID || '',
      agency: env.POLAR_PRODUCT_AGENCY_ID || env.POLAR_PRODUCT_VIP_ID || ''
    }
  };
}

function getProductIdForPlan(planKey, config) {
  const key = (planKey === 'vip' || planKey === 'unlimited') ? 'agency' : planKey;
  return config.products[key] || null;
}

function getPlanForProductId(productId, config) {
  if (!productId) return null;
  for (const [plan, pId] of Object.entries(config.products)) {
    if (pId && pId === productId) return plan;
  }
  return null;
}

// 1. GET POLAR CONFIGURATION STATUS
polarApp.get('/api/polar/config', async (c) => {
  const config = getPolarConfig(c.env);
  return c.json({
    configured: !!config.accessToken,
    environment: config.environment,
    products: config.products
  });
});

// 2. CREATE CHECKOUT SESSION
polarApp.post('/api/polar/create-checkout', authenticateToken, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const planKey = (body.plan || '').toLowerCase();

  const normalizedPlan = (planKey === 'vip' || planKey === 'unlimited') ? 'agency' : planKey;
  if (!['basic', 'pro', 'agency'].includes(normalizedPlan)) {
    return c.json({ error: `Invalid plan selected: ${planKey}` }, 400);
  }

  const config = getPolarConfig(c.env);
  if (!config.accessToken) {
    return c.json({ error: 'Polar payment gateway is not configured on this server.' }, 503);
  }

  const productId = getProductIdForPlan(normalizedPlan, config);
  if (!productId) {
    return c.json({ error: `No product ID configured for plan: ${normalizedPlan}` }, 400);
  }

  const origin = new URL(c.req.url).origin;
  const successUrl = `${origin}/purchase.html?payment=success&plan=${normalizedPlan}&checkout_id={CHECKOUT_ID}`;
  const returnUrl = `${origin}/purchase.html?payment=cancelled`;

  try {
    const payload = {
      product_id: productId,
      customer_email: user.email,
      customer_metadata: {
        user_id: user.id,
        plan: normalizedPlan
      },
      success_url: successUrl,
      return_url: returnUrl
    };

    const res = await fetch(`${config.apiBase}/checkouts/custom/`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok || !data.url) {
      console.error('Polar create checkout failed:', data);
      await recordUserLog(c, {
        userId: user.id,
        action: 'payment_checkout_failed',
        level: 'WARN',
        message: `Failed creating checkout for plan ${normalizedPlan}`,
        statusCode: res.status || 500
      });
      return c.json({ error: data.detail || 'Failed to create Polar checkout session' }, res.status || 500);
    }

    await recordUserLog(c, {
      userId: user.id,
      action: 'payment_checkout',
      level: 'INFO',
      message: `User created checkout for plan "${normalizedPlan}"`,
      statusCode: 200,
      details: { plan: normalizedPlan, checkoutId: data.id }
    });

    return c.json({
      success: true,
      url: data.url,
      id: data.id
    });
  } catch (err) {
    console.error('Polar checkout exception:', err);
    return c.json({ error: err.message }, 500);
  }
});

// 3. CREATE CUSTOMER PORTAL SESSION
polarApp.get('/api/polar/portal', authenticateToken, async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const config = getPolarConfig(c.env);

  if (!config.accessToken) {
    return c.json({ error: 'Polar payment gateway is not configured.' }, 503);
  }

  try {
    const dbUser = await db.prepare('SELECT polar_customer_id FROM users WHERE id = ?').bind(user.id).first();
    if (!dbUser || !dbUser.polar_customer_id) {
      return c.json({ error: 'No active subscription or customer record found for this user.' }, 404);
    }

    const res = await fetch(`${config.apiBase}/customer-portal/sessions/`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        customer_id: dbUser.polar_customer_id
      })
    });

    const data = await res.json();
    if (!res.ok || !data.url) {
      return c.json({ error: data.detail || 'Failed to create customer portal session' }, res.status || 500);
    }

    return c.json({ success: true, url: data.url });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// 4. POLAR WEBHOOK HANDLER
polarApp.post('/api/polar/webhook', async (c) => {
  const db = c.env.DB;
  const config = getPolarConfig(c.env);

  try {
    const rawBody = await c.req.text();
    let event = null;
    try {
      event = JSON.parse(rawBody);
    } catch (e) {
      return c.text('Invalid JSON payload', 400);
    }

    const eventType = event.type || event.event || 'unknown';
    const eventId = event.id || crypto.randomUUID();
    const eventData = event.data || {};

    // Record webhook event into polar_events
    try {
      await db.prepare(`
        INSERT OR IGNORE INTO polar_events (id, event_type, payload)
        VALUES (?, ?, ?)
      `).bind(eventId, eventType, rawBody).run();
    } catch (e) {
      console.warn('Could not record polar event:', e.message);
    }

    console.log(`[Polar Webhook] Processing event: ${eventType} (ID: ${eventId})`);

    // Handle Order Created
    if (eventType === 'order.created') {
      const customerEmail = (eventData.customer && eventData.customer.email) || eventData.customer_email;
      const customerId = eventData.customer_id || (eventData.customer && eventData.customer.id);
      const productId = eventData.product_id;
      const plan = getPlanForProductId(productId, config) || (eventData.metadata && eventData.metadata.plan) || 'basic';
      const quota = (PLAN_CONFIG[plan] && PLAN_CONFIG[plan].posts) || 30;

      if (customerEmail) {
        await db.prepare(`
          UPDATE users
          SET subscription = ?,
              posts_left = posts_left + ?,
              polar_customer_id = COALESCE(polar_customer_id, ?),
              polar_product_id = ?
          WHERE LOWER(TRIM(email)) = LOWER(TRIM(?))
        `).bind(plan, quota, customerId, productId, customerEmail).run();
        console.log(`[Polar Webhook] Order applied for ${customerEmail}: plan=${plan}, added ${quota} posts`);

        await recordUserLog(c, {
          username: customerEmail,
          action: 'payment_order_applied',
          level: 'INFO',
          message: `Payment received from ${customerEmail}: Plan "${plan}", added ${quota} posts`,
          statusCode: 200,
          details: { customerEmail, plan, quota, productId }
        });
      }
    }

    // Handle Subscription Created or Updated
    if (eventType === 'subscription.created' || eventType === 'subscription.updated') {
      const customerEmail = (eventData.customer && eventData.customer.email) || eventData.customer_email;
      const customerId = eventData.customer_id || (eventData.customer && eventData.customer.id);
      const subscriptionId = eventData.id;
      const productId = eventData.product_id;
      const status = eventData.status;
      const plan = getPlanForProductId(productId, config) || (eventData.metadata && eventData.metadata.plan) || 'basic';
      const quota = (PLAN_CONFIG[plan] && PLAN_CONFIG[plan].posts) || 30;

      if (customerEmail && status === 'active') {
        await db.prepare(`
          UPDATE users
          SET subscription = ?,
              posts_left = CASE WHEN posts_left < ? THEN ? ELSE posts_left END,
              polar_customer_id = ?,
              polar_subscription_id = ?,
              polar_product_id = ?
          WHERE LOWER(TRIM(email)) = LOWER(TRIM(?))
        `).bind(plan, quota, quota, customerId, subscriptionId, productId, customerEmail).run();
        console.log(`[Polar Webhook] Subscription updated for ${customerEmail}: plan=${plan}`);

        await recordUserLog(c, {
          username: customerEmail,
          action: 'payment_subscription_updated',
          level: 'INFO',
          message: `Subscription updated for ${customerEmail}: plan=${plan} (Status: ${status})`,
          statusCode: 200,
          details: { customerEmail, plan, quota, subscriptionId, status }
        });
      }
    }

    // Handle Subscription Revoked / Cancelled
    if (eventType === 'subscription.revoked' || eventType === 'subscription.canceled') {
      const subscriptionId = eventData.id;
      if (subscriptionId) {
        await db.prepare(`
          UPDATE users
          SET subscription = 'free',
              polar_subscription_id = NULL
          WHERE polar_subscription_id = ?
        `).bind(subscriptionId).run();
        console.log(`[Polar Webhook] Subscription revoked: ${subscriptionId}`);

        await recordUserLog(c, {
          action: 'payment_subscription_revoked',
          level: 'WARN',
          message: `Subscription revoked (ID: ${subscriptionId})`,
          statusCode: 200,
          details: { subscriptionId }
        });
      }
    }

    return c.json({ received: true });
  } catch (err) {
    console.error('[Polar Webhook Error]', err);
    return c.json({ error: err.message }, 500);
  }
});

