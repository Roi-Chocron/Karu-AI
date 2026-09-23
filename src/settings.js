import { Hono } from 'hono';
import { requireAdmin } from './auth.js';

export const settingsApp = new Hono();

// 1. GET ALL SETTINGS
settingsApp.get('/api/admin/settings', requireAdmin, async (c) => {
  const db = c.env.DB;
  try {
    const { results } = await db.prepare('SELECT key, value FROM settings').all();
    const settingsMap = {};
    if (results) {
      for (const row of results) {
        settingsMap[row.key] = row.value;
      }
    }
    const sysPrompt = settingsMap.system_prompt || settingsMap.systemPrompt || '';
    const imgPrompt = settingsMap.image_system_prompt || settingsMap.imageSystemPrompt || '';
    const selModel = settingsMap.selected_model || settingsMap.selectedModel || '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
    const actProv = settingsMap.active_provider || settingsMap.activeProvider || 'cloudflare';
    const imgProv = settingsMap.image_active_provider || settingsMap.imageActiveProvider || 'cloudflare';
    const imgModel = settingsMap.image_gen_model || settingsMap.imageGenModel || '@cf/black-forest-labs/flux-1-schnell';

    return c.json({
      ...settingsMap,
      systemPrompt: sysPrompt,
      system_prompt: sysPrompt,
      imageSystemPrompt: imgPrompt,
      image_system_prompt: imgPrompt,
      selectedModel: selModel,
      selected_model: selModel,
      activeProvider: actProv,
      active_provider: actProv,
      imageActiveProvider: imgProv,
      image_active_provider: imgProv,
      imageGenModel: imgModel,
      image_gen_model: imgModel
    });
  } catch (err) {
    return c.json({ error: 'Failed to fetch settings' }, 500);
  }
});

// 2. SAVE SETTINGS
settingsApp.post('/api/admin/settings', requireAdmin, async (c) => {
  const db = c.env.DB;
  const updates = await c.req.json();

  try {
    for (const [key, value] of Object.entries(updates)) {
      await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
        .bind(key, String(value || ''))
        .run();
      // Also map camelCase to snake_case for DB storage
      if (key === 'systemPrompt') {
        await db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('system_prompt', ?)").bind(String(value || '')).run();
      } else if (key === 'imageSystemPrompt') {
        await db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('image_system_prompt', ?)").bind(String(value || '')).run();
      } else if (key === 'imageActiveProvider') {
        await db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('image_active_provider', ?)").bind(String(value || '')).run();
      }
    }
    return c.json({ success: true, message: 'Settings updated successfully' });
  } catch (err) {
    return c.json({ error: 'Failed to update settings' }, 500);
  }
});

// 3. AVAILABLE MODELS
settingsApp.get('/api/admin/models', requireAdmin, async (c) => {
  const isImage = c.req.query('type') === 'image';
  if (!isImage) {
    return c.json({
      activeProvider: 'cloudflare',
      models: [
        { name: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', displayName: 'Meta Llama 3.3 70B Instruct (Cloudflare Edge)' }
      ]
    });
  }
  return c.json({
    activeProvider: 'cloudflare',
    models: [
      { name: '@cf/black-forest-labs/flux-2-dev', displayName: 'FLUX.2 Dev (32B SOTA - Ultra Realistic)' },
      { name: '@cf/black-forest-labs/flux-1-schnell', displayName: 'FLUX.1 Schnell (High Speed)' },
      { name: '@cf/stabilityai/stable-diffusion-xl-base-1.0', displayName: 'Stable Diffusion XL (Cloudflare Edge)' },
      { name: '@cf/bytedance/stable-diffusion-xl-lightning', displayName: 'SDXL Lightning (Ultra Fast)' }
    ]
  });
});
