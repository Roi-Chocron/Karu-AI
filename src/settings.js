import { Hono } from 'hono';
import { requireAdmin } from './auth.js';
import { recordUserLog } from './logger.js';

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
      } else if (key === 'selectedModel') {
        await db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('selected_model', ?)").bind(String(value || '')).run();
      } else if (key === 'imageGenModel') {
        await db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('image_gen_model', ?)").bind(String(value || '')).run();
      }
    }

    const adminUser = c.get('user');
    await recordUserLog(c, {
      userId: adminUser?.id,
      username: adminUser?.username || adminUser?.email,
      action: 'admin_update_settings',
      level: 'INFO',
      message: `Admin updated system settings (${Object.keys(updates).join(', ')})`,
      statusCode: 200,
      details: { updatedKeys: Object.keys(updates) }
    });

    return c.json({ success: true, message: 'Settings updated successfully' });
  } catch (err) {
    return c.json({ error: 'Failed to update settings' }, 500);
  }
});

// 3. AVAILABLE MODELS
settingsApp.get('/api/admin/models', requireAdmin, async (c) => {
  const type = c.req.query('type') || 'text';
  const provider = (c.req.query('provider') || 'cloudflare').toLowerCase();
  const apiKey = c.req.query('apiKey') || '';

  if (type !== 'image') {
    // Return all Cloudflare Workers AI Language Models
    return c.json({
      provider: 'cloudflare',
      models: [
        { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', name: 'Meta Llama 3.3 70B Instruct (FP8 Fast - מומלץ)', recommended: true, type: 'chat' },
        { id: '@cf/meta/llama-3.1-8b-instruct-fast', name: 'Meta Llama 3.1 8B Instruct Fast (מהיר וקליל)', type: 'chat' },
        { id: '@cf/meta/llama-3.2-3b-instruct', name: 'Meta Llama 3.2 3B Instruct (קומפקטי וחסכוני)', type: 'chat' },
        { id: '@cf/meta/llama-3.2-1b-instruct', name: 'Meta Llama 3.2 1B Instruct (אולטרה-מהיר)', type: 'chat' },
        { id: '@cf/meta/llama-3.1-70b-instruct', name: 'Meta Llama 3.1 70B Instruct (עמוק ואיכותי)', type: 'chat' },
        { id: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', name: 'DeepSeek R1 Distill Qwen 32B (חשיבה עמוקה והיגיון)', type: 'reasoning' },
        { id: '@cf/qwen/qwq-32b', name: 'Qwen QwQ 32B (היגיון מתקדם)', type: 'reasoning' },
        { id: '@cf/qwen/qwen3-30b-a3b-fp8', name: 'Qwen 3 30B A3B FP8 (דור הבא)', type: 'chat' },
        { id: '@cf/qwen/qwen2.5-72b-instruct', name: 'Qwen 2.5 72B Instruct (מודל ענק מתקדם)', type: 'chat' },
        { id: '@cf/mistral/mistral-7b-instruct-v0.2', name: 'Mistral 7B Instruct v0.2', type: 'chat' },
        { id: '@cf/google/gemma-7b-it', name: 'Google Gemma 7B IT', type: 'chat' }
      ]
    });
  }

  // Image Models per provider
  if (provider === 'cloudflare') {
    return c.json({
      provider: 'cloudflare',
      models: [
        { id: '@cf/black-forest-labs/flux-2-dev', name: 'FLUX.2 Dev (32B SOTA - פוטוריאליסטי)' },
        { id: '@cf/black-forest-labs/flux-2-klein-4b', name: 'FLUX.2 Klein 4B (סופר מהיר)' },
        { id: '@cf/black-forest-labs/flux-1-schnell', name: 'FLUX.1 Schnell (איכות ומהירות)' },
        { id: '@cf/stabilityai/stable-diffusion-xl-base-1.0', name: 'Stable Diffusion XL Base 1.0' },
        { id: '@cf/bytedance/stable-diffusion-xl-lightning', name: 'SDXL Lightning (אולטרה מהיר)' },
        { id: '@cf/lykon/dreamshaper-8-lcm', name: 'Dreamshaper 8 LCM (סגנון אמנותי)' }
      ]
    });
  }

  if (provider === 'openrouter') {
    try {
      const resp = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { 'User-Agent': 'KaruAI/1.0' }
      });
      if (resp.ok) {
        const data = await resp.json();
        const list = Array.isArray(data?.data) ? data.data : [];
        const imageModels = list.filter(m => {
          const id = (m.id || '').toLowerCase();
          const desc = (m.description || '').toLowerCase();
          return id.includes('flux') || id.includes('diffusion') || id.includes('image') || id.includes('recraft') || id.includes('dall-e') || id.includes('sdxl') || desc.includes('image generation') || desc.includes('text-to-image');
        }).map(m => ({
          id: m.id,
          name: m.name || m.id
        }));

        if (imageModels.length > 0) {
          return c.json({ provider: 'openrouter', models: imageModels, live: true });
        }
      }
    } catch (e) {
      console.warn('OpenRouter models live fetch error:', e.message);
    }

    return c.json({
      provider: 'openrouter',
      models: [
        { id: 'black-forest-labs/flux-1.1-pro', name: 'FLUX 1.1 Pro (BFL SOTA)' },
        { id: 'black-forest-labs/flux-1-dev', name: 'FLUX.1 Dev' },
        { id: 'black-forest-labs/flux-1-schnell', name: 'FLUX.1 Schnell' },
        { id: 'google/gemini-2.5-flash-image', name: 'Gemini 2.5 Flash Image' },
        { id: 'recraft/recraft-v3', name: 'Recraft v3 (Vector & Design)' },
        { id: 'stabilityai/stable-diffusion-xl-base-1.0', name: 'SDXL Base 1.0' },
        { id: 'stabilityai/sdxl-turbo', name: 'SDXL Turbo' }
      ],
      live: false
    });
  }

  if (provider === 'huggingface') {
    try {
      const resp = await fetch('https://huggingface.co/api/models?pipeline_tag=text-to-image&sort=downloads&direction=-1&limit=30', {
        headers: { 'User-Agent': 'KaruAI/1.0', ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}) }
      });
      if (resp.ok) {
        const data = await resp.json();
        if (Array.isArray(data) && data.length > 0) {
          const models = data.map(m => ({
            id: m.id,
            name: `${m.id} (${(m.downloads || 0).toLocaleString()} downloads)`
          }));
          return c.json({ provider: 'huggingface', models, live: true });
        }
      }
    } catch (e) {
      console.warn('HuggingFace models live fetch error:', e.message);
    }

    return c.json({
      provider: 'huggingface',
      models: [
        { id: 'black-forest-labs/FLUX.1-schnell', name: 'FLUX.1 Schnell (Black Forest Labs)' },
        { id: 'black-forest-labs/FLUX.1-dev', name: 'FLUX.1 Dev (SOTA Quality)' },
        { id: 'stabilityai/stable-diffusion-3.5-large', name: 'Stable Diffusion 3.5 Large' },
        { id: 'stabilityai/stable-diffusion-3.5-medium', name: 'Stable Diffusion 3.5 Medium' },
        { id: 'stabilityai/stable-diffusion-xl-base-1.0', name: 'SDXL Base 1.0' },
        { id: 'ByteDance/SDXL-Lightning', name: 'SDXL Lightning (4-Step)' },
        { id: 'RoiChocron/FLUX.1-schnell-bucket', name: 'RoiChocron FLUX.1 Schnell Bucket' }
      ],
      live: false
    });
  }

  if (provider === 'google') {
    if (apiKey) {
      try {
        const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        if (resp.ok) {
          const data = await resp.json();
          const list = Array.isArray(data?.models) ? data.models : [];
          const imgModels = list.filter(m => {
            const name = (m.name || '').toLowerCase();
            return name.includes('image') || name.includes('imagen');
          }).map(m => ({
            id: m.name.replace('models/', ''),
            name: m.displayName || m.name.replace('models/', '')
          }));
          if (imgModels.length > 0) {
            return c.json({ provider: 'google', models: imgModels, live: true });
          }
        }
      } catch (e) {
        console.warn('Google models live fetch error:', e.message);
      }
    }
    return c.json({
      provider: 'google',
      models: [
        { id: 'imagen-3.0-generate-002', name: 'Imagen 3.0 Generation 002 (איכות מקסימלית)' },
        { id: 'imagen-3.0-generate-001', name: 'Imagen 3.0 Standard' },
        { id: 'imagen-3.0-fast-generate-001', name: 'Imagen 3.0 Fast' },
        { id: 'image-generation-001', name: 'Imagen 2 (Legacy)' },
        { id: 'gemini-2.0-flash-exp', name: 'Gemini 2.0 Flash Multimodal' }
      ],
      live: false
    });
  }

  if (provider === 'openai') {
    return c.json({
      provider: 'openai',
      models: [
        { id: 'dall-e-3', name: 'DALL-E 3 (1024x1024 / 1792x1024 HD)' },
        { id: 'dall-e-2', name: 'DALL-E 2 (512x512 / 1024x1024)' },
        { id: 'gpt-image-1', name: 'GPT Image 1' }
      ]
    });
  }

  if (provider === 'puter') {
    return c.json({
      provider: 'puter',
      models: [
        { id: 'gpt-image-1-mini', name: 'GPT Image 1 Mini (OpenAI — מהיר וחינמי)' },
        { id: 'gpt-image-1', name: 'GPT Image 1 (OpenAI)' },
        { id: 'gpt-image-2', name: 'GPT Image 2 (OpenAI)' },
        { id: 'black-forest-labs/flux-schnell', name: 'FLUX.1 Schnell (Black Forest Labs)' },
        { id: 'black-forest-labs/flux-1.1-pro', name: 'FLUX 1.1 Pro' },
        { id: 'black-forest-labs/flux-dev', name: 'FLUX Dev' },
        { id: 'stabilityai/stable-diffusion-xl-base-1.0', name: 'SDXL Base 1.0' },
        { id: 'dall-e-3', name: 'DALL-E 3 (דרך Puter)' },
        { id: 'dall-e-2', name: 'DALL-E 2 (דרך Puter)' }
      ]
    });
  }

  return c.json({ provider, models: [] });
});
