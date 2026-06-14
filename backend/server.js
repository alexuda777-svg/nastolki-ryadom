const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'nastolki2024';

['hosts', 'cafes', 'tables', 'bookings', 'feedback'].forEach(d => {
  const p = path.join(DATA_DIR, d);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

function readAll(type) {
  const dir = path.join(DATA_DIR, type);
  try {
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
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
  const updated = { ...item, ...updates, id };
  fs.writeFileSync(file, JSON.stringify(updated, null, 2));
  return updated;
}

function deleteItem(type, id) {
  const file = path.join(DATA_DIR, type, `${id}.json`);
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
    return true;
  }
  return false;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
  });
}

function isAdmin(req) {
  const auth = req.headers['authorization'] || '';
  return auth === `Bearer ${ADMIN_PASSWORD}`;
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

  const options = {
    hostname: 'api.telegram.org',
    path: `/bot${token}/sendMessage`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  };

  try {
    const r = http.request(options);
    r.write(body);
    r.end();
  } catch {
    // игнорируем ошибки телеги
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }
  const h = corsHeaders();

  // health-check
  if (req.method === 'GET' && pathname === '/health') {
    res.writeHead(200, h);
    res.end(
      JSON.stringify({
        status: 'ok',
        time: new Date().toISOString()
      })
    );
    return;
  }

  // Публичные эндпоинты (только approved)
  if (req.method === 'GET' && pathname === '/api/tables') {
    const all = readAll('tables').filter(t => t.status === 'approved');
    res.writeHead(200, h);
    res.end(JSON.stringify(all));
    return;
  }

  if (req.method === 'GET' && pathname === '/api/hosts') {
    const all = readAll('hosts')
      .filter(x => x.status === 'approved')
      .map(x => ({ ...x, email: undefined }));
    res.writeHead(200, h);
    res.end(JSON.stringify(all));
    return;
  }

  if (req.method === 'GET' && pathname === '/api/cafes') {
    const all = readAll('cafes')
      .filter(x => x.status === 'approved')
      .map(x => ({ ...x, email: undefined, phone: undefined }));
    res.writeHead(200, h);
    res.end(JSON.stringify(all));
    return;
  }

  // Публичное создание заявок
  if (req.method === 'POST' && pathname === '/api/hosts') {
    try {
      const data = await parseBody(req);
      if (!data.name || !data.telegram) {
        res.writeHead(400, h);
        res.end(
          JSON.stringify({ error: 'Имя и Telegram обязательны' })
        );
        return;
      }
      const item = saveItem('hosts', { ...data, status: 'pending' });
      sendTg(
        `🎭 <b>Новый ведущий!</b>\n👤 ${data.name}\n📱 ${data.telegram}\n🏙 ${
          data.city || '—'
        }\n🎮 ${data.games || '—'}`
      );
      res.writeHead(201, h);
      res.end(JSON.stringify({ success: true, id: item.id }));
    } catch (e) {
      res.writeHead(400, h);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/cafes') {
    try {
      const data = await parseBody(req);
      if (!data.name || !data.telegram) {
        res.writeHead(400, h);
        res.end(
          JSON.stringify({
            error: 'Название и Telegram обязательны'
          })
        );
        return;
      }
      const item = saveItem('cafes', { ...data, status: 'pending' });
      sendTg(
        `☕ <b>Новое кафе!</b>\n🏠 ${data.name}\n📱 ${data.telegram}\n📍 ${
          data.address || '—'
        }`
      );
      res.writeHead(201, h);
      res.end(JSON.stringify({ success: true, id: item.id }));
    } catch (e) {
      res.writeHead(400, h);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/tables') {
    try {
      const data = await parseBody(req);
      if (!data.game || !data.hostTelegram || !data.date) {
        res.writeHead(400, h);
        res.end(
          JSON.stringify({
            error: 'Игра, Telegram и дата обязательны'
          })
        );
        return;
      }
      const item = saveItem('tables', {
        ...data,
        status: 'pending',
        seats_taken: data.seats_taken || 0
      });
      sendTg(
        `🎲 <b>Новый стол!</b>\n🎮 ${data.game}\n📱 ${
          data.hostTelegram
        }\n📅 ${data.date} ${data.time || ''}\n🏠 ${
          data.venue || '—'
        }`
      );
      res.writeHead(201, h);
      res.end(JSON.stringify({ success: true, id: item.id }));
    } catch (e) {
      res.writeHead(400, h);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/bookings') {
    try {
      const data = await parseBody(req);
      if (!data.tableId || !data.name || !data.telegram) {
        res.writeHead(400, h);
        res.end(
          JSON.stringify({ error: 'Все поля обязательны' })
        );
        return;
      }
      const item = saveItem('bookings', {
        ...data,
        status: 'pending'
      });
      sendTg(
        `📋 <b>Запись на стол!</b>\n👤 ${data.name}\n📱 ${
          data.telegram
        }\n🎮 Стол: ${data.tableId}`
      );
      res.writeHead(201, h);
      res.end(JSON.stringify({ success: true, id: item.id }));
    } catch (e) {
      res.writeHead(400, h);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Защита админ-API
  if (pathname.startsWith('/api/admin') && !isAdmin(req)) {
    res.writeHead(401, h);
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  // Админская статистика
  if (req.method === 'GET' && pathname === '/api/admin/stats') {
    const hosts = readAll('hosts');
    const cafes = readAll('cafes');
    const tables = readAll('tables');
    const bookings = readAll('bookings');
    res.writeHead(200, h);
    res.end(
      JSON.stringify({
        hosts: {
          total: hosts.length,
          pending: hosts.filter(x => x.status === 'pending').length,
          approved: hosts.filter(x => x.status === 'approved').length
        },
        cafes: {
          total: cafes.length,
          pending: cafes.filter(x => x.status === 'pending').length,
          approved: cafes.filter(x => x.status === 'approved').length
        },
        tables: {
          total: tables.length,
          pending: tables.filter(x => x.status === 'pending').length,
          approved: tables.filter(x => x.status === 'approved').length
        },
        bookings: {
          total: bookings.length,
          pending: bookings.filter(x => x.status === 'pending').length
        }
      })
    );
    return;
  }

  // Админ: списки
  if (req.method === 'GET' && pathname.startsWith('/api/admin/')) {
    const parts = pathname.split('/');
    const type = parts[3];
    if (!['hosts', 'cafes', 'tables', 'bookings', 'feedback'].includes(type)) {
      res.writeHead(404, h);
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    const items = readAll(type);
    const sf = url.searchParams.get('status');
    const filtered = sf ? items.filter(i => i.status === sf) : items;
    filtered.sort(
      (a, b) =>
        new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
    );
    res.writeHead(200, h);
    res.end(JSON.stringify(filtered));
    return;
  }

  // Админ: обновление (одобрение и т.п.)
  if (req.method === 'PUT' && pathname.startsWith('/api/admin/')) {
    const parts = pathname.split('/');
    const type = parts[3];
    const id = parts[4];
    if (!['hosts', 'cafes', 'tables', 'bookings'].includes(type)) {
      res.writeHead(404, h);
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    try {
      const data = await parseBody(req);
      const updated = updateItem(type, id, data);
      if (!updated) {
        res.writeHead(404, h);
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
      }
      res.writeHead(200, h);
      res.end(JSON.stringify(updated));
    } catch (e) {
      res.writeHead(400, h);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Админ: удаление
  if (req.method === 'DELETE' && pathname.startsWith('/api/admin/')) {
    const parts = pathname.split('/');
    const type = parts[3];
    const id = parts[4];
    const ok = deleteItem(type, id);
    res.writeHead(ok ? 200 : 404, h);
    res.end(JSON.stringify({ success: ok }));
    return;
  }

  res.writeHead(404, h);
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`✅ Сервер запущен на порту ${PORT}`);
  console.log(`📂 Данные: ${DATA_DIR}`);
  console.log(`🔐 Пароль админки: ${ADMIN_PASSWORD}`);
});
