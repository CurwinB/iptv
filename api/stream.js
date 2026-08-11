const ALLOWED_HOSTS = new Set();

function isAllowedUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

function absolutize(value, base) {
  try { return new URL(value, base).toString(); } catch { return value; }
}

export default async function handler(req, res) {
  const target = typeof req.query.url === 'string' ? req.query.url : '';
  if (!target || !isAllowedUrl(target)) {
    return res.status(400).json({ error: 'Invalid stream URL' });
  }

  try {
    const upstream = await fetch(target, {
      headers: { 'User-Agent': 'Mozilla/5.0 IPTV Player' },
      redirect: 'follow'
    });

    if (!upstream.ok) return res.status(upstream.status).send(`Upstream returned ${upstream.status}`);

    const contentType = upstream.headers.get('content-type') || '';
    const looksLikeManifest = contentType.includes('mpegurl') || /\.m3u8(?:$|\?)/i.test(target);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');

    if (!looksLikeManifest) {
      res.setHeader('Content-Type', contentType || 'application/octet-stream');
      const buffer = Buffer.from(await upstream.arrayBuffer());
      return res.status(200).send(buffer);
    }

    const text = await upstream.text();
    const base = new URL(target);
    const rewritten = text.split(/\r?\n/).map(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        if (trimmed.startsWith('#EXT-X-KEY:') || trimmed.startsWith('#EXT-X-MAP:') || trimmed.startsWith('#EXT-X-MEDIA:')) {
          return trimmed.replace(/URI="([^"]+)"/g, (_, uri) => `URI="/api/stream?url=${encodeURIComponent(absolutize(uri, base))}"`);
        }
        return line;
      }
      const absolute = absolutize(trimmed, base);
      return `/api/stream?url=${encodeURIComponent(absolute)}`;
    }).join('\n');

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    return res.status(200).send(rewritten);
  } catch (error) {
    console.error('Stream proxy error:', error);
    return res.status(502).json({ error: 'Unable to reach upstream stream' });
  }
}
