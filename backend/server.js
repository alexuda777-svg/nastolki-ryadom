const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');
const PUBLIC_DIR = ROOT_DIR;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'nastolki2026';

['hosts', 'cafes', 'tables', 'bookings', 'feedback'].forEach((d) => {
  const p = path.join(DATA_DIR, d);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

function corsHeaders(contentType = 'application/json; charset=utf-8') {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': contentType
  };
}

function sendJson(res, code, data) {
  res.writeHead(code, corsHeaders());
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function isAdmin(req) {
  const auth = req.headers.authorization || '';
  return auth === `Bearer ${ADMIN_PASSWORD}`;
}

function normalizeHost(data = {}) {
  return {
    ...data,
    telegram: data.telegram || data.contact || '',
    contact: data.contact || data.telegram || ''
  };
}

function normalizeCafe(data = {}) {
  return {
    ...data,
    telegram: data.telegram || data.contact || '',
    contact: data.contact || data.telegram || ''
  };
}

function normalizeTable(data = {}) {
  const seatsTaken =
    Number(data.seatsTaken ?? data.seats_taken ?? data.seatstaken ?? 0) || 0;

  return {
    ...data,
    hostTelegram: data.hostTelegram || data.contact || data.telegram || '',
    contact: data.contact || data.hostTelegram || data.telegram || '',
    seatsTaken,
    seats_taken: seatsTaken
  };
}

function normalizeBooking(data = {}) {
  return {
    ...data,
    telegram: data.telegram || data.contact || '',
    contact: data.contact || data.telegram || ''
  };
}

function readAll(type) {
  const dir = path.join(DATA_DIR, type);
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  } catch {
    return [];
  }
}

function saveItem(type, data) {
  const id = data.id || crypto.randomUUID();
  const item = {
    ...data,
    id,
    createdAt: data.createdAt || new Date().toISOString()
  };
  fs.writeFileSync(
    path.join(DATA_DIR, type, `${id}.json`),
    JSON.stringify(item, null, 2)
  );
  return item;
}

function updateItem(type, id, updates) {
  const file = path.join(DATA_DIR, type, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  const item = JSON.parse(fs.readFileSync(file, 'utf8'));
  const updated = {
    ...item,
    ...updates,
    id,
    updatedAt: new Date().toISOString()
  };
  fs.writeFileSync(file, JSON.stringify(updated, null, 2));
  return updated;
}

function deleteItem(type, id) {
  const file = path.join(DATA_DIR, type, `${id}.json`);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

function sendTg(message) {
  const token = process.env.TG_BOT_TOKEN;
  const chatId = process.env.TG_CHAT_ID;
  if (!token || !chatId) return;

  const body = JSON.stringify({
    chat_id: chatId,
    text: message,
    parse_mode: 'HTML'
  });

  const req = https.request(
    {
      hostname: 'api.telegram.org',
      path: `/bot${token}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    },
    (r) => {
      r.on('data', () => {});
    }
  );

  req.on('error', () => {});
  req.write(body);
  req.end();
}

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8'
  };
  return map[ext] || 'application/octet-stream';
}

function serveStatic(req, res, pathname) {
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return true;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    res.writeHead(200, corsHeaders(mimeType(filePath)));
    fs.createReadStream(filePath).pipe(res);
    return true;
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (req.method === 'GET' && pathname === '/health') {
    sendJson(res, 200, { status: 'ok', time: new Date().toISOString() });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/tables') {
    const all = readAll('tables')
      .map(normalizeTable)
      .filter((t) => t.status === 'approved');
    sendJson(res, 200, all);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/hosts') {
    const all = readAll('hosts')
      .map(normalizeHost)
      .filter((x) => x.status === 'approved')
      .map(({ email, ...x }) => x);
    sendJson(res, 200, all);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/cafes') {
    const all = readAll('cafes')
      .map(normalizeCafe)
      .filter((x) => x.status === 'approved')
      .map(({ email, phone, ...x }) => x);
    sendJson(res, 200, all);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/hosts') {
    try {
      const data = normalizeHost(await parseBody(req));
      if (!data.name || !data.telegram) {
        sendJson(res, 400, { error: 'Имя и Telegram обязательны' });
        return;
      }
      const item = saveItem('hosts', { ...data, status: 'pending' });
      sendTg(`🎭 <b>Новый ведущий!</b>\n👤 ${data.name}\n📱 ${data.telegram}\n🏙 ${data.city || '—'}\n🎮 ${data.games || '—'}`);
      sendJson(res, 201, { success: true, id: item.id });
    } catch (e) {
      sendJson(res, 400, { error: e.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/cafes') {
    try {
      const data = normalizeCafe(await parseBody(req));
      if (!data.name || !data.telegram) {
        sendJson(res, 400, { error: 'Название и Telegram обязательны' });
        return;
      }
      const item = saveItem('cafes', { ...data, status: 'pending' });
      sendTg(`☕ <b>Новое кафе!</b>\n🏠 ${data.name}\n📱 ${data.telegram}\n📍 ${data.address || '—'}`);
      sendJson(res, 201, { success: true, id: item.id });
    } catch (e) {
      sendJson(res, 400, { error: e.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/tables') {
    try {
      const raw = await parseBody(req);
      const data = normalizeTable(raw);

      if (!data.game || !data.hostTelegram || !data.date) {
        sendJson(res, 400, { error: 'Игра, Telegram и дата обязательны' });
        return;
      }

      const item = saveItem('tables', {
        ...data,
        status: 'pending'
      });

      sendTg(`🎲 <b>Новый стол!</b>\n🎮 ${data.game}\n📱 ${data.hostTelegram}\n📅 ${data.date} ${data.time || ''}\n🏠 ${data.venue || '—'}`);
      sendJson(res, 201, { success: true, id: item.id });
    } catch (e) {
      sendJson(res, 400, { error: e.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/bookings') {
    try {
      const data = normalizeBooking(await parseBody(req));

      if (!data.tableId || !data.name || !data.telegram) {
        sendJson(res, 400, { error: 'tableId, name и telegram обязательны' });
        return;
      }

      const tables = readAll('tables').map(normalizeTable);
      const table = tables.find((t) => String(t.id) === String(data.tableId));

      if (!table) {
        sendJson(res, 404, { error: 'Стол не найден' });
        return;
      }

      const totalSeats = Number(table.seats || 0) || 0;
      const takenSeats = Number(table.seatsTaken || 0) || 0;

      if (totalSeats > 0 && takenSeats >= totalSeats) {
        sendJson(res, 400, { error: 'Свободных мест больше нет' });
        return;
      }

      const secret = crypto.randomBytes(16).toString('hex');

      const item = saveItem('bookings', {
        ...data,
        status: 'pending',
        secret
      });

      updateItem('tables', table.id, {
        seatsTaken: takenSeats + 1,
        seats_taken: takenSeats + 1
      });

      sendTg(`📋 <b>Запись на стол!</b>\n👤 ${data.name}\n📱 ${data.telegram}\n🎮 Стол: ${data.tableId}`);
      sendJson(res, 201, { success: true, id: item.id, secret });
    } catch (e) {
      sendJson(res, 400, { error: e.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/booking-contact') {
    try {
      const data = await parseBody(req);
      const { bookingId, secret } = data;

      if (!bookingId || !secret) {
        sendJson(res, 400, { error: 'bookingId и secret обязательны' });
        return;
      }

      const booking = readAll('bookings').find((b) => String(b.id) === String(bookingId));
      if (!booking || booking.secret !== secret) {
        sendJson(res, 404, { error: 'Запись не найдена' });
        return;
      }

      const table = readAll('tables').map(normalizeTable).find((t) => String(t.id) === String(booking.tableId));
      if (!table) {
        sendJson(res, 404, { error: 'Стол не найден' });
        return;
      }

      const contact = table.hostTelegram || table.contact || table.telegram;
      if (!contact) {
        sendJson(res, 404, { error: 'Контакт не указан организатором' });
        return;
      }

      sendJson(res, 200, { contact });
    } catch (e) {
      sendJson(res, 400, { error: e.message });
    }
    return;
  }

  if (pathname.startsWith('/api/admin') && !isAdmin(req)) {
    sendJson(res, 401, { error: 'Unauthorized' });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/admin/stats') {
    const hosts = readAll('hosts');
    const cafes = readAll('cafes');
    const tables = readAll('tables');
    const bookings = readAll('bookings');

    sendJson(res, 200, {
      hosts: {
        total: hosts.length,
        pending: hosts.filter((x) => x.status === 'pending').length,
        approved: hosts.filter((x) => x.status === 'approved').length
      },
      cafes: {
        total: cafes.length,
        pending: cafes.filter((x) => x.status === 'pending').length,
        approved: cafes.filter((x) => x.status === 'approved').length
      },
      tables: {
        total: tables.length,
        pending: tables.filter((x) => x.status === 'pending').length,
        approved: tables.filter((x) => x.status === 'approved').length
      },
      bookings: {
        total: bookings.length,
        pending: bookings.filter((x) => x.status === 'pending').length,
        approved: bookings.filter((x) => x.status === 'approved').length
      }
    });
    return;
  }

  if (req.method === 'GET' && pathname.startsWith('/api/admin/')) {
    const parts = pathname.split('/');
    const type = parts[3];

    if (!['hosts', 'cafes', 'tables', 'bookings', 'feedback'].includes(type)) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }

    const sf = url.searchParams.get('status');
    const items = readAll(type);
    const filtered = sf ? items.filter((i) => i.status === sf) : items;

    filtered.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    sendJson(res, 200, filtered);
    return;
  }

  if (req.method === 'PUT' && pathname.startsWith('/api/admin/')) {
    const parts = pathname.split('/');
    const type = parts[3];
    const id = parts[4];

    if (!['hosts', 'cafes', 'tables', 'bookings', 'feedback'].includes(type)) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }

    try {
      const data = await parseBody(req);
      const updated = updateItem(type, id, data);
      if (!updated) {
        sendJson(res, 404, { error: 'Not found' });
        return;
      }
      sendJson(res, 200, updated);
    } catch (e) {
      sendJson(res, 400, { error: e.message });
    }
    return;
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/admin/')) {
    const parts = pathname.split('/');
    const type = parts[3];
    const id = parts[4];

    if (!['hosts', 'cafes', 'tables', 'bookings', 'feedback'].includes(type)) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }

    const ok = deleteItem(type, id);
    sendJson(res, ok ? 200 : 404, { success: ok });
    return;
  }

  if (req.method === 'GET' && serveStatic(req, res, pathname)) {
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`✅ Сервер запущен на порту ${PORT}`);
  console.log(`📂 Данные: ${DATA_DIR}`);
});
