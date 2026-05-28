const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

// Инициализация базы данных SQLite (файл taxi.db создастся автоматически)
const db = new Database('taxi.db');
db.pragma('journal_mode = WAL');

// Создаём таблицы, если их нет
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('passenger', 'driver')),
    name TEXT,
    rating REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    passenger_id TEXT NOT NULL,
    driver_id TEXT,
    from_lat REAL NOT NULL,
    from_lng REAL NOT NULL,
    to_lat REAL NOT NULL,
    to_lng REAL NOT NULL,
    tariff TEXT NOT NULL,
    price REAL,
    status TEXT NOT NULL DEFAULT 'pending',
    passenger_rating REAL,
    driver_rating REAL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (passenger_id) REFERENCES users(id),
    FOREIGN KEY (driver_id) REFERENCES users(id)
  );
`);

// Вспомогательная функция для хэширования паролей (в продакшене использовать bcrypt)
function hashPassword(password) {
  // Простейший хэш, для реального проекта замените на bcrypt
  return require('crypto').createHash('sha256').update(password).digest('hex');
}

// ---------- Аутентификация (упрощённая) ----------
// Регистрация
app.post('/api/register', (req, res) => {
  const { email, password, role, name } = req.body;
  if (!email || !password || !role) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    return res.status(409).json({ error: 'User already exists' });
  }
  const id = uuidv4();
  const hashed = hashPassword(password);
  db.prepare('INSERT INTO users (id, email, password, role, name) VALUES (?, ?, ?, ?, ?)').run(id, email, hashed, role, name || '');
  res.status(201).json({ id, email, role });
});

// Вход
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || user.password !== hashPassword(password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  // В реальном приложении здесь выдаётся JWT-токен, пока возвращаем данные пользователя
  res.json({ id: user.id, email: user.email, role: user.role, name: user.name, rating: user.rating });
});

// ---------- Заказы ----------
// Создать заказ (пассажир)
app.post('/api/orders', (req, res) => {
  const { passenger_id, from_lat, from_lng, to_lat, to_lng, tariff } = req.body;
  if (!passenger_id || from_lat == null || from_lng == null || to_lat == null || to_lng == null || !tariff) {
    return res.status(400).json({ error: 'Missing order details' });
  }
  const id = uuidv4();
  db.prepare('INSERT INTO orders (id, passenger_id, from_lat, from_lng, to_lat, to_lng, tariff, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, passenger_id, from_lat, from_lng, to_lat, to_lng, tariff, 'pending');
  res.status(201).json({ id, status: 'pending' });
});

// Получить доступные заказы (для водителей)
app.get('/api/orders/available', (req, res) => {
  const orders = db.prepare("SELECT * FROM orders WHERE status = 'pending' ORDER BY created_at ASC").all();
  res.json(orders);
});

// Водитель принимает заказ
app.put('/api/orders/:id/accept', (req, res) => {
  const { driver_id } = req.body;
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.status !== 'pending') return res.status(400).json({ error: 'Order is already taken' });
  db.prepare('UPDATE orders SET driver_id = ?, status = ?, updated_at = datetime("now") WHERE id = ?')
    .run(driver_id, 'accepted', order.id);
  res.json({ success: true });
});

// Обновить статус заказа (например, "arrived", "in_progress", "completed")
app.put('/api/orders/:id/status', (req, res) => {
  const { status } = req.body;
  db.prepare('UPDATE orders SET status = ?, updated_at = datetime("now") WHERE id = ?').run(status, req.params.id);
  res.json({ success: true });
});

// Завершить поездку и выставить рейтинги
app.put('/api/orders/:id/complete', (req, res) => {
  const { passenger_rating, driver_rating } = req.body;
  db.prepare('UPDATE orders SET status = ?, passenger_rating = ?, driver_rating = ?, updated_at = datetime("now") WHERE id = ?')
    .run('completed', passenger_rating || null, driver_rating || null, req.params.id);
  // Обновить средние рейтинги пользователей (упрощённо)
  const order = db.prepare('SELECT passenger_id, driver_id FROM orders WHERE id = ?').get(req.params.id);
  if (order && passenger_rating) {
    const avg = db.prepare('SELECT AVG(passenger_rating) as avg FROM orders WHERE passenger_id = ? AND passenger_rating NOT NULL').get(order.passenger_id);
    db.prepare('UPDATE users SET rating = ? WHERE id = ?').run(avg.avg || 0, order.passenger_id);
  }
  if (order && driver_rating) {
    const avg = db.prepare('SELECT AVG(driver_rating) as avg FROM orders WHERE driver_id = ? AND driver_rating NOT NULL').get(order.driver_id);
    db.prepare('UPDATE users SET rating = ? WHERE id = ?').run(avg.avg || 0, order.driver_id);
  }
  res.json({ success: true });
});

// История заказов пользователя
app.get('/api/orders/user/:userId', (req, res) => {
  const orders = db.prepare('SELECT * FROM orders WHERE passenger_id = ? OR driver_id = ? ORDER BY created_at DESC').all(req.params.userId, req.params.userId);
  res.json(orders);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});