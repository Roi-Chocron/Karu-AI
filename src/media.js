import { Hono } from 'hono';
import { authenticateToken } from './auth.js';
import { recordUserLog } from './logger.js';

export const mediaApp = new Hono();

// 1. UPLOAD IMAGE
mediaApp.post('/api/upload-image', authenticateToken, async (c) => {
  const kv = c.env.KARU_MEDIA;
  const contentType = c.req.header('content-type') || '';

  try {
    let filename = '';
    let buffer = null;
    let mimeType = 'image/png';

    if (contentType.includes('application/json')) {
      const body = await c.req.json();
      const { image, name } = body;
      if (!image) {
        return c.json({ error: 'No image data provided' }, 400);
      }

      // Check if it's base64 data URL
      const matches = image.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        mimeType = matches[1];
        const binaryStr = atob(matches[2]);
        const len = binaryStr.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        buffer = bytes.buffer;
      } else {
        // Raw base64
        const binaryStr = atob(image);
        const len = binaryStr.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        buffer = bytes.buffer;
      }

      const ext = mimeType.split('/')[1] || 'png';
      filename = `upload_${crypto.randomUUID().slice(0, 10)}.${ext}`;
    } else if (contentType.includes('multipart/form-data')) {
      const formData = await c.req.formData();
      const file = formData.get('file') || formData.get('image');
      if (!file || typeof file === 'string') {
        return c.json({ error: 'No file uploaded' }, 400);
      }
      buffer = await file.arrayBuffer();
      mimeType = file.type || 'image/png';
      const ext = (file.name && file.name.split('.').pop()) || 'png';
      filename = `upload_${crypto.randomUUID().slice(0, 10)}.${ext}`;
    } else {
      // Raw binary
      buffer = await c.req.arrayBuffer();
      filename = `upload_${crypto.randomUUID().slice(0, 10)}.png`;
    }

    if (!buffer || buffer.byteLength === 0) {
      return c.json({ error: 'Empty file received' }, 400);
    }

    // Save to Cloudflare KV
    await kv.put(filename, buffer, {
      metadata: { contentType: mimeType }
    });

    const url = `/api/media/${filename}`;

    await recordUserLog(c, {
      action: 'media_upload',
      level: 'INFO',
      message: `User uploaded image: ${filename} (${Math.round(buffer.byteLength / 1024)} KB)`,
      statusCode: 200,
      details: { filename, mimeType, sizeBytes: buffer.byteLength }
    });

    return c.json({ success: true, url, filename });
  } catch (err) {
    console.error('Upload image error:', err);
    await recordUserLog(c, {
      action: 'media_upload_error',
      level: 'ERROR',
      message: `Image upload failed: ${err.message}`,
      statusCode: 500,
      details: { error: err.message }
    });
    return c.json({ error: 'Failed to process uploaded image' }, 500);
  }
});

// 2. SERVE MEDIA
mediaApp.get('/api/media/:filename', async (c) => {
  const filename = c.req.param('filename');
  const kv = c.env.KARU_MEDIA;

  try {
    const { value, metadata } = await kv.getWithMetadata(filename, { type: 'arrayBuffer' });
    if (!value) {
      return c.text('Media not found', 404);
    }

    const mimeType = (metadata && metadata.contentType) || 'image/png';

    return new Response(value, {
      headers: {
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=31536000, immutable'
      }
    });
  } catch (err) {
    return c.text('Error retrieving media', 500);
  }
});
