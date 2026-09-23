import { Hono } from 'hono';
import { authenticateToken } from './auth.js';

export const aiApp = new Hono();

// ─── Default system prompt (overridden by DB setting) ─────────────────────────
const DEFAULT_SYSTEM_PROMPT = `# System Prompt: Elite UI/UX & High-Converting Carousel Generator (540x540)

<role>
You are an Elite Digital Art Director, Lead UI/UX Designer, and master Copywriter. Your mission is to generate stunning, high-converting, visually cohesive Instagram Carousel posts strictly formatted as JSON.
You despise "AI Slop", generic bland templates, unformatted raw text, and boring slides. Every carousel you generate must look like an intentional, agency-grade design campaign.
CRITICALLY: You must act as an Art Director overseeing a UNIFIED campaign. The entire carousel must feel like one cohesive editorial piece, not a random collection of slides.
</role>

<core_constraints>
1. ABSOLUTE CANVAS LIMIT (540x540):
   Every slide is rendered inside a fixed 540x540 pixel canvas with overflow: hidden. All visual content must comfortably fit inside this boundary without any scrolling or vertical overflow.
2. ZERO TOLERANCE FOR EMOJIS:
   Do NOT use emojis anywhere. Use pure typographic hierarchy, crisp SVG icons, or geometric accent shapes instead.
3. LANGUAGE & DIRECTION:
   You fully support Hebrew and English. Match the language requested by the user:
   - If Hebrew: text MUST be in natural, modern Hebrew. The container MUST have direction: rtl; text-align: right; font-family: 'Heebo', sans-serif;
   - If English: direction: ltr; text-align: left; font-family: 'Inter', sans-serif;
   NEVER refuse Hebrew requests.
4. STRICT JSON OUTPUT:
   Output ONLY valid JSON starting with { and ending with }. Do not include markdown code block backticks.
</core_constraints>

<critical_architectural_rule>
THE VIEWER RENDERS EXCLUSIVELY html_content:
The carousel iframe in the application displays ONLY AND EXACTLY the HTML string stored in slide.html_content. The JSON fields "title" and "tag" are metadata.
THEREFORE:
1. EVERYTHING that should be seen by the viewer MUST be coded inside slide.html_content.
2. Every slide MUST visually include:
   - Category Badge / Tag pill badge
   - Main Large Headline (h1 or h2, between 34px and 50px)
   - Body Copy / Key Points / Card Layout (font size 17px-20px)
3. If you leave slide.html_content with only a p tag and omit the title or tag, the slide will appear completely broken and unstyled!
</critical_architectural_rule>

<image_generation>
If the user requests images, FIRST output an image plan JSON:
{
  "type": "image_plan",
  "images": [
    { "description": "detailed cinematic prompt for image 1 in English" }
  ]
}
Wait for the system to reply with the generated image URLs.
Once the system replies with the URLs, output the final carousel JSON with images embedded in html_content.
</image_generation>

<output_format>
{
  "id": "uuid-v4",
  "author_name": "AuthorName",
  "created_at": "YYYY-MM-DDTHH:mm:ss.sssZ",
  "tokens_used": 150,
  "description": "Short description.",
  "hashtags": "#tag1 #tag2",
  "slides": [
    {
      "slide_index": 0,
      "tag": "Tag Label",
      "title": "Slide Title",
      "background_style": "background-color: #0b1120;",
      "html_content": "<link href=\"https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;700;900&display=swap\" rel=\"stylesheet\"><div style=\"width: 100%; height: 100%; box-sizing: border-box; overflow: hidden; position: relative; padding: 44px; display: flex; flex-direction: column; justify-content: space-between; direction: rtl; text-align: right; font-family: 'Heebo', sans-serif; background: #0b1120; color: #f8fafc;\"><div><div style=\"display: inline-flex; align-items: center; padding: 6px 14px; border-radius: 999px; font-size: 13px; font-weight: 700; letter-spacing: 0.04em; background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); width: fit-content; margin-bottom: 20px;\">Tag Label</div><h1 style=\"font-size: 44px; font-weight: 900; line-height: 1.05; letter-spacing: -0.03em; margin: 0 0 18px 0; color: #ffffff;\">Slide <span style=\"color: #38bdf8;\">Title</span></h1><p style=\"font-size: 18px; line-height: 1.55; opacity: 0.9; margin: 0; color: #cbd5e1;\">Body text goes here with rich, informative content about the topic.</p></div><div style=\"display: flex; align-items: center; justify-content: space-between; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.1); font-size: 13px; color: #94a3b8;\"><span>01 / 03</span><span style=\"font-weight: 700; color: #38bdf8;\">KaruAI</span></div></div>"
    }
  ]
}
</output_format>`;

// ─── Helper: extract JSON from raw LLM output ────────────────────────────────
function extractCarouselJson(input) {
  if (!input) return null;

  if (typeof input === 'object') {
    if (Array.isArray(input.slides) && input.slides.length > 0) return input;
    if (input.carousel && Array.isArray(input.carousel.slides)) return input.carousel;
    if (input.type === 'image_plan') return input;
    if (input.response) return extractCarouselJson(input.response);
  }

  if (typeof input !== 'string') return null;

  let str = input.trim();
  // Strip DeepSeek R1 <think>...</think> block
  str = str.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  // Strip markdown fences
  str = str.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  // Try direct parse
  try {
    const obj = JSON.parse(str);
    const res = obj.carousel || obj;
    if (typeof res.slides === 'string') {
      try { res.slides = JSON.parse(res.slides); } catch (e) {}
    }
    if (res.type === 'image_plan' || (Array.isArray(res.slides) && res.slides.length > 0)) return res;
  } catch (e) {}

  // Try extracting from first { to last }
  const firstBrace = str.indexOf('{');
  const lastBrace = str.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const subStr = str.substring(firstBrace, lastBrace + 1);
    try {
      const obj = JSON.parse(subStr);
      const res = obj.carousel || obj;
      if (typeof res.slides === 'string') {
        try { res.slides = JSON.parse(res.slides); } catch (e) {}
      }
      if (res.type === 'image_plan' || (Array.isArray(res.slides) && res.slides.length > 0)) return res;
    } catch (e) {
      try {
        const sanitized = subStr.replace(/[\u0000-\u001F]+/g, (m) =>
          m === '\n' ? '\\n' : m === '\r' ? '\\r' : m === '\t' ? '\\t' : ''
        );
        const obj = JSON.parse(sanitized);
        const res = obj.carousel || obj;
        if (typeof res.slides === 'string') {
          try { res.slides = JSON.parse(res.slides); } catch (e2) {}
        }
        if (res.type === 'image_plan' || (Array.isArray(res.slides) && res.slides.length > 0)) return res;
      } catch (e2) {}
    }
  }

  return null;
}

// ─── Helper: generate a single image via Cloudflare Workers AI SDXL ─────────
async function generateWorkerImage(c, promptText) {
  const ai = c.env.AI;
  const kv = c.env.KARU_MEDIA;
  const db = c.env.DB;
  const selectedModel = '@cf/stabilityai/stable-diffusion-xl-base-1.0';

  const response = await ai.run(selectedModel, { prompt: promptText.trim() });

  let arrayBuffer;
  if (response instanceof ReadableStream) {
    const reader = response.getReader();
    const chunks = [];
    let totalLength = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalLength += value.length;
    }
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    arrayBuffer = combined.buffer;
  } else if (response instanceof ArrayBuffer) {
    arrayBuffer = response;
  } else if (response && response.image) {
    const binaryStr = atob(response.image);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
    arrayBuffer = bytes.buffer;
  } else {
    arrayBuffer = await new Response(response).arrayBuffer();
  }

  const genId = crypto.randomUUID();
  const filename = `cf_gen_${Date.now()}_${genId.slice(0, 8)}.png`;

  await kv.put(filename, arrayBuffer, { metadata: { contentType: 'image/png' } });

  const imageUrl = `/api/media/${filename}`;

  try {
    await db.prepare(
      'INSERT INTO cloudflare_generations (id, prompt, model, image_url) VALUES (?, ?, ?, ?)'
    ).bind(genId, promptText.trim(), selectedModel, imageUrl).run();
  } catch (e) {
    console.warn('Failed to insert into cloudflare_generations:', e.message);
  }

  return imageUrl;
}

// ─── Helper: run LLM (Cloudflare Workers AI — DeepSeek R1 32B / Settings) ───
async function runLLMChat(c, messages) {
  const db = c.env.DB;
  let selectedModel = '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b';

  try {
    const selRow = await db.prepare(
      "SELECT value FROM settings WHERE key = 'selected_model' OR key = 'selectedModel'"
    ).first();
    if (selRow && selRow.value && selRow.value.trim()) {
      const val = selRow.value.trim();
      if (val.startsWith('@cf/')) {
        selectedModel = val;
      }
    }
  } catch (err) {
    console.warn('Could not read selected_model from settings:', err.message);
  }

  try {
    const aiRes = await c.env.AI.run(selectedModel, {
      messages,
      max_tokens: 4096,
      temperature: 0.6
    });
    return typeof aiRes === 'string' ? aiRes : (aiRes.response || '');
  } catch (err) {
    console.error(`LLM chat error with model ${selectedModel}:`, err);
    // Fallback to Llama 3.3 70B if DeepSeek R1 temporarily times out or fails
    if (selectedModel !== '@cf/meta/llama-3.3-70b-instruct-fp8-fast') {
      try {
        console.log('Attempting fallback to @cf/meta/llama-3.3-70b-instruct-fp8-fast...');
        const fallbackRes = await c.env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
          messages,
          max_tokens: 4096,
          temperature: 0.6
        });
        return typeof fallbackRes === 'string' ? fallbackRes : (fallbackRes.response || '');
      } catch (fbErr) {
        console.error('Fallback LLM chat error:', fbErr);
      }
    }
    return '';
  }
}

// ─── Helper: backend slide enrichment (safety net if model omits h1) ─────────
function enrichSlides(slides) {
  return slides.map((slide, sIdx) => {
    if (!slide || typeof slide !== 'object') return slide;
    const html = slide.html_content || '';
    const hasHeading = /<h[1-3][^>]*>/i.test(html);
    if (hasHeading) return slide;

    const title = (slide.title || '').trim();
    const tag = (slide.tag || '').trim();
    if (!title && !tag) return slide;

    const bodyText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const isRtl = /[\u0590-\u05FF]/.test(title + ' ' + bodyText + ' ' + tag);
    const direction = isRtl ? 'rtl' : 'ltr';
    const textAlign = isRtl ? 'right' : 'left';
    const fontFamily = isRtl ? "'Heebo', sans-serif" : "'Inter', sans-serif";
    const accentColors = ['#ef4444', '#38bdf8', '#10b981', '#f59e0b'];
    const accent = accentColors[sIdx % accentColors.length];

    let bgStyle = (slide.background_style || 'background: #0b1120;').trim();
    if (!bgStyle.endsWith(';')) bgStyle += ';';
    if (!bgStyle.includes('background')) bgStyle = `background: ${bgStyle};`;

    const badgeHtml = tag
      ? `<div style="display: inline-flex; align-items: center; padding: 6px 14px; border-radius: 999px; font-size: 13px; font-weight: 700; letter-spacing: 0.04em; background: rgba(56, 189, 248, 0.15); color: ${accent}; border: 1px solid rgba(56, 189, 248, 0.3); width: fit-content; margin-bottom: 20px;">${tag}</div>`
      : '';
    const titleHtml = title
      ? `<h1 style="font-size: 42px; font-weight: 900; line-height: 1.05; letter-spacing: -0.03em; margin: 0 0 20px 0; color: #ffffff;">${title}</h1>`
      : '';
    const contentHtml = bodyText
      ? `<div style="background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 14px; padding: 20px;"><p style="font-size: 18px; line-height: 1.55; opacity: 0.92; margin: 0; color: #cbd5e1;">${bodyText}</p></div>`
      : '';
    const footerHtml = `<div style="display: flex; align-items: center; justify-content: space-between; padding-top: 16px; border-top: 1px solid rgba(255, 255, 255, 0.1); font-size: 13px; color: #94a3b8;"><span>0${sIdx + 1} / 0${slides.length}</span><span style="font-weight: 700; color: ${accent};">KaruAI</span></div>`;

    slide.html_content = `<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;700;900&display=swap" rel="stylesheet"><div style="width: 100%; height: 100%; box-sizing: border-box; overflow: hidden; position: relative; padding: 44px; display: flex; flex-direction: column; justify-content: space-between; direction: ${direction}; text-align: ${textAlign}; font-family: ${fontFamily}; color: #f8fafc; ${bgStyle}"><div style="position: absolute; top: -80px; left: -80px; width: 220px; height: 220px; border-radius: 50%; background: radial-gradient(circle, rgba(56, 189, 248, 0.15) 0%, transparent 70%); pointer-events: none;"></div><div>${badgeHtml}${titleHtml}${contentHtml}</div>${footerHtml}</div>`;
    return slide;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// 1. GENERATE IMAGE VIA CLOUDFLARE WORKERS AI
aiApp.post('/api/cloudflare-images/generate', async (c) => {
  const { prompt } = await c.req.json();
  if (!prompt || !prompt.trim()) {
    return c.json({ error: 'Prompt is required' }, 400);
  }

  try {
    const imageUrl = await generateWorkerImage(c, prompt.trim());
    return c.json({
      success: true,
      image: {
        prompt: prompt.trim(),
        image_url: imageUrl,
        created_at: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error('Cloudflare image generation error:', err);
    return c.json({ error: `AI Generation failed: ${err.message}` }, 500);
  }
});

// 2. GET CLOUDFLARE IMAGE HISTORY
aiApp.get('/api/cloudflare-images/history', async (c) => {
  const db = c.env.DB;
  try {
    const { results } = await db.prepare(`
      SELECT id, prompt, model, image_url, created_at
      FROM cloudflare_generations
      ORDER BY created_at DESC
      LIMIT 100
    `).all();
    return c.json({ success: true, images: results || [] });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// 3. STATS
aiApp.get('/api/cloudflare-images/stats', async (c) => {
  const db = c.env.DB;
  try {
    const totalRow = await db.prepare('SELECT count(*) as total FROM cloudflare_generations').first();
    return c.json({
      success: true,
      total_generations: totalRow?.total || 0,
      active_model: '@cf/stabilityai/stable-diffusion-xl-base-1.0'
    });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// 4. BATCH GENERATE IMAGES
aiApp.post('/api/generate-images', authenticateToken, async (c) => {
  const { prompts } = await c.req.json();
  if (!prompts || !Array.isArray(prompts)) {
    return c.json({ error: 'Invalid prompts array' }, 400);
  }

  const results = [];
  for (const item of prompts) {
    const promptText = typeof item === 'string' ? item : (item.description || item.prompt || '');
    if (!promptText) continue;
    try {
      const url = await generateWorkerImage(c, promptText);
      results.push({ prompt: promptText, url, success: true });
    } catch (err) {
      results.push({ prompt: promptText, error: err.message, success: false });
    }
  }

  return c.json({ success: true, images: results });
});

// 5. CHAT / CAROUSEL GENERATION (LLM + IMAGE PIPELINE)
aiApp.post('/api/chat', authenticateToken, async (c) => {
  const userPayload = c.get('user');
  const db = c.env.DB;
  const { message, history, postId } = await c.req.json();

  if (!message) {
    return c.json({ error: 'Message content is missing' }, 400);
  }

  try {
    const user = await db.prepare(
      'SELECT id, username, subscription, posts_left FROM users WHERE id = ?'
    ).bind(userPayload.id).first();
    if (!user) return c.json({ error: 'User not found' }, 401);

    // Fetch system prompt from DB, fall back to default
    const sysPromptRow = await db.prepare("SELECT value FROM settings WHERE key = 'system_prompt'").first();
    const systemPrompt = sysPromptRow?.value || DEFAULT_SYSTEM_PROMPT;

    // Build messages array
    const messages = [{ role: 'system', content: systemPrompt }];
    if (Array.isArray(history)) {
      for (const h of history) {
        if (h.role && h.content) {
          messages.push({ role: h.role === 'assistant' ? 'assistant' : 'user', content: h.content });
        }
      }
    }
    messages.push({ role: 'user', content: message });

    // 1st LLM call
    let rawResponse = await runLLMChat(c, messages);
    let parsed = extractCarouselJson(rawResponse);

    // If an image plan was generated, auto-generate images then call LLM again
    if (parsed && parsed.type === 'image_plan' && Array.isArray(parsed.images) && parsed.images.length > 0) {
      const generatedUrls = [];
      for (const imgItem of parsed.images.slice(0, 3)) {
        const desc = typeof imgItem === 'string' ? imgItem : (imgItem.description || imgItem.prompt || 'Modern artistic composition');
        try {
          const url = await generateWorkerImage(c, desc);
          if (url) generatedUrls.push(url);
        } catch (genErr) {
          console.error('Auto image gen failed for prompt:', desc, genErr);
        }
      }

      if (generatedUrls.length > 0) {
        messages.push({ role: 'assistant', content: JSON.stringify(parsed) });
        messages.push({
          role: 'user',
          content: `Images generated successfully. URLs: ${generatedUrls.join(', ')}. Now please generate the final carousel JSON. Embed the provided image URLs directly into html_content using <img src="..." style="width:100%;height:100%;object-fit:cover;position:absolute;top:0;left:0;opacity:0.35;z-index:1;" /> or CSS background-image. Output ONLY valid JSON starting with { and ending with }.`
        });
        rawResponse = await runLLMChat(c, messages);
        parsed = extractCarouselJson(rawResponse);
      }
    }

    let activePostId = postId || null;
    let replyText = '';

    if (parsed && Array.isArray(parsed.slides) && parsed.slides.length > 0) {
      // Apply backend slide enrichment safety net
      parsed.slides = enrichSlides(parsed.slides);

      if (!activePostId) {
        // Check post quota
        if (user.subscription !== 'agency' && user.subscription !== 'unlimited' && user.posts_left <= 0) {
          return c.json({ error: 'No remaining posts left in your current package.' }, 400);
        }
        activePostId = 'p_' + crypto.randomUUID().slice(0, 8);
      }
      parsed.id = activePostId;

      const title = parsed.title || parsed.slides[0]?.title || message.slice(0, 60);
      const description = parsed.description || `Carousel on topic: ${title}`;
      const hashtags = parsed.hashtags || '#KaruAI';
      const tokensPrompt = Math.floor(1000 + Math.random() * 1000);
      const tokensSave = Math.floor(500 + Math.random() * 500);

      const carouselData = JSON.stringify({
        id: activePostId,
        author_name: user.username,
        created_at: new Date().toISOString(),
        title,
        description,
        hashtags,
        slides: parsed.slides
      });

      const existingPost = await db.prepare('SELECT id FROM posts WHERE id = ?').bind(activePostId).first();
      if (existingPost) {
        await db.prepare(`
          UPDATE posts SET title = ?, description = ?, hashtags = ?, carousel_data = ?
          WHERE id = ? AND (user_id = ? OR user_id IS NULL)
        `).bind(title, description, hashtags, carouselData, activePostId, userPayload.id).run();
      } else {
        await db.prepare(`
          INSERT INTO posts (id, user_id, username, title, description, hashtags, tokens_prompt, tokens_save, tokens_autopost, carousel_data)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(activePostId, userPayload.id, user.username, title, description, hashtags, tokensPrompt, tokensSave, 0, carouselData).run();

        if (user.subscription !== 'agency' && user.subscription !== 'unlimited' && user.posts_left > 0) {
          await db.prepare('UPDATE users SET posts_left = posts_left - 1 WHERE id = ?').bind(userPayload.id).run();
        }
      }

      replyText = `הקרוסלה נוצרה בהצלחה! (${parsed.slides.length} שקופיות)`;
    } else {
      const cleanRaw = typeof rawResponse === 'string' ? rawResponse.replace(/<think>[\s\S]*?<\/think>/gi, '').trim() : '';
      replyText = cleanRaw || 'התקבלה תשובה מהמודל';
    }

    // Save chat history
    if (activePostId) {
      const existingForHistory = await db.prepare('SELECT chat_history FROM posts WHERE id = ?').bind(activePostId).first();
      let chatArr = [];
      if (existingForHistory && existingForHistory.chat_history) {
        try { chatArr = JSON.parse(existingForHistory.chat_history); } catch (e) {}
      }
      chatArr.push({ role: 'user', content: message });
      chatArr.push({ role: 'assistant', content: replyText });
      await db.prepare('UPDATE posts SET chat_history = ? WHERE id = ?')
        .bind(JSON.stringify(chatArr), activePostId).run();
    }

    return c.json({
      success: true,
      reply: replyText,
      carousel: parsed && Array.isArray(parsed.slides) && parsed.slides.length > 0 ? parsed : null,
      postId: activePostId
    });

  } catch (err) {
    console.error('Chat error:', err);
    return c.json({ error: `Chat generation failed: ${err.message}` }, 500);
  }
});
