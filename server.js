const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

const DATA_FILE = path.join(__dirname, 'data.json');

// Загрузка или инициализация "базы данных"
function loadData() {
    if (!fs.existsSync(DATA_FILE)) {
        fs.writeFileSync(DATA_FILE, JSON.stringify({ users: [], orders: [] }, null, 2));
    }
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(raw);
}

function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Хеш пароля
function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

// ---------- АУТЕНТИФИКАЦИЯ ----------
app.post('/api/register', (req, res) => {
    const { email, password, role, name } = req.body;
    if (!email || !password || !role) {
        return res.status(400).json({ error: 'Все поля обязательны' });
    }
    const db = loadData();
    if (db.users.find(u => u.email === email)) {
        return res.status(409).json({ error: 'Пользователь уже существует' });
    }
    const user = {
        id: uuidv4(),
        email,
        password: hashPassword(password),
        role,
        name: name || '',
        rating: 0,
        created_at: new Date().toISOString()
    };
    db.users.push(user);
    saveData(db);
    res.status(201).json({ id: user.id, email: user.email, role: user.role });
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    const db = loadData();
    const user = db.users.find(u => u.email === email);
    if (!user || user.password !== hashPassword(password)) {
        return res.status(401).json({ error: 'Неверные учётные данные' });
    }
    res.json({ id: user.id, email: user.email, role: user.role, name: user.name, rating: user.rating });
});

// ---------- ЗАКАЗЫ ----------
app.post('/api/orders', (req, res) => {
    const { passenger_id, from_lat, from_lng, to_lat, to_lng, tariff } = req.body;
    if (!passenger_id || from_lat == null || from_lng == null || to_lat == null || to_lng == null || !tariff) {
        return res.status(400).json({ error: 'Не все данные заказа указаны' });
    }
    const db = loadData();
    const order = {
        id: uuidv4(),
        passenger_id,
        driver_id: null,
        from_lat, from_lng,
        to_lat, to_lng,
        tariff,
        price: null,
        status: 'pending',
        passenger_rating: null,
        driver_rating: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };
    db.orders.push(order);
    saveData(db);
    res.status(201).json({ id: order.id, status: 'pending' });
});

// Доступные заказы (для водителя)
app.get('/api/orders/available', (req, res) => {
    const db = loadData();
    res.json(db.orders.filter(o => o.status === 'pending'));
});

// Водитель берёт заказ
app.put('/api/orders/:id/accept', (req, res) => {
    const { driver_id } = req.body;
    const db = loadData();
    const order = db.orders.find(o => o.id === req.params.id);
    if (!order) return res.status(404).json({ error: 'Заказ не найден' });
    if (order.status !== 'pending') return res.status(400).json({ error: 'Заказ уже принят' });
    order.driver_id = driver_id;
    order.status = 'accepted';
    order.updated_at = new Date().toISOString();
    saveData(db);
    res.json({ success: true });
});

// Изменение статуса заказа
app.put('/api/orders/:id/status', (req, res) => {
    const { status } = req.body;
    const db = loadData();
    const order = db.orders.find(o => o.id === req.params.id);
    if (!order) return res.status(404).json({ error: 'Заказ не найден' });
    order.status = status;
    order.updated_at = new Date().toISOString();
    saveData(db);
    res.json({ success: true });
});

// Завершение заказа и рейтинги
app.put('/api/orders/:id/complete', (req, res) => {
    const { passenger_rating, driver_rating } = req.body;
    const db = loadData();
    const order = db.orders.find(o => o.id === req.params.id);
    if (!order) return res.status(404).json({ error: 'Заказ не найден' });

    order.status = 'completed';
    order.updated_at = new Date().toISOString();
    if (passenger_rating !== undefined) order.passenger_rating = passenger_rating;
    if (driver_rating !== undefined) order.driver_rating = driver_rating;
    saveData(db);

    // Пересчёт средних рейтингов (упрощённо)
    if (passenger_rating !== undefined) {
        const passengerOrders = db.orders.filter(o => o.passenger_id === order.passenger_id && o.passenger_rating != null);
        const avg = passengerOrders.reduce((s, o) => s + o.passenger_rating, 0) / passengerOrders.length;
        const user = db.users.find(u => u.id === order.passenger_id);
        if (user) user.rating = avg;
    }
    if (driver_rating !== undefined && order.driver_id) {
        const driverOrders = db.orders.filter(o => o.driver_id === order.driver_id && o.driver_rating != null);
        const avg = driverOrders.reduce((s, o) => s + o.driver_rating, 0) / driverOrders.length;
        const driver = db.users.find(u => u.id === order.driver_id);
        if (driver) driver.rating = avg;
    }
    saveData(db);
    res.json({ success: true });
});

// История заказов пользователя
app.get('/api/orders/user/:userId', (req, res) => {
    const db = loadData();
    const userOrders = db.orders.filter(o => o.passenger_id === req.params.userId || o.driver_id === req.params.userId);
    res.json(userOrders);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});