// Сервер веб-мессенджера
// - Express раздаёт статику из /public
// - Socket.io обеспечивает обмен в реальном времени
// - MongoDB (через mongoose) хранит историю сообщений
// - Онлайн-пользователи отслеживаются в памяти (socket.id -> username)

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

// Локально можно использовать файл .env (на хостинге переменные задаются в панели)
// Не делаем обязательной зависимость от .env — если файла нет, просто продолжаем.
try {
  require('dotenv').config();
} catch (_) {}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('Ошибка: не задана переменная окружения MONGO_URI');
  console.error('Создайте .env (локально) или задайте MONGO_URI на хостинге.');
  process.exit(1);
}

// Схема сообщений в БД
// Структура: username, text, createdAt
const messageSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, trim: true, maxlength: 32 },
    text: { type: String, required: true, trim: true, maxlength: 500 },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

const Message = mongoose.model('Message', messageSchema);

// Онлайн-пользователи (в памяти)
// socket.id -> username
const onlineUsersBySocket = new Map();

function sanitizeUsername(value) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 32);
}

function sanitizeText(value) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 500);
}

function getOnlineUsernames() {
  // Отдаём уникальные имена в алфавитном порядке
  const set = new Set(onlineUsersBySocket.values());
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'ru'));
}

function makeUniqueUsername(baseName) {
  const existing = new Set(onlineUsersBySocket.values());
  if (!existing.has(baseName)) return baseName;

  // Если имя занято, добавляем суффикс #2, #3, ...
  let i = 2;
  while (existing.has(`${baseName}#${i}`) && i < 999) i++;
  return `${baseName}#${i}`;
}

// Раздаём статику из папки public
app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  console.log('Новое подключение:', socket.id);

  // Клиент должен сообщить имя после открытия страницы
  socket.on('user:join', async (data) => {
    const rawName = sanitizeUsername(data?.username);
    if (!rawName) return;

    const finalName = makeUniqueUsername(rawName);
    socket.data.username = finalName;
    onlineUsersBySocket.set(socket.id, finalName);

    // Подтверждаем имя (если пришлось сделать уникальным)
    socket.emit('user:accepted', { username: finalName });

    // Рассылаем обновлённый список онлайн-пользователей всем
    io.emit('users:list', getOnlineUsernames());

    // Отдаём историю сообщений (последние 200)
    try {
      const history = await Message.find({})
        .sort({ createdAt: 1 })
        .limit(200)
        .lean();

      // Приводим к формату клиента
      socket.emit(
        'chat:init',
        history.map((m) => ({
          username: m.username,
          text: m.text,
          createdAt: m.createdAt,
        }))
      );
    } catch (err) {
      console.error('Ошибка загрузки истории:', err);
      socket.emit('chat:init', []);
    }
  });

  // Обновление имени пользователя без изменения истории
  socket.on('user:updateName', (data) => {
    const rawName = sanitizeUsername(data?.username);
    if (!rawName) return;

    const finalName = makeUniqueUsername(rawName);
    socket.data.username = finalName;
    onlineUsersBySocket.set(socket.id, finalName);

    // Подтверждаем новое имя конкретному пользователю
    socket.emit('user:accepted', { username: finalName });
    // Рассылаем обновлённый список онлайн-пользователей всем
    io.emit('users:list', getOnlineUsernames());
  });

  // Обработка входящего сообщения
  socket.on('chat:message', async (data) => {
    const user = sanitizeUsername(socket.data.username);
    const text = sanitizeText(data?.text);
    if (!user || !text) return;

    try {
      const doc = await Message.create({ username: user, text });

      // Отправляем сообщение всем подключённым клиентам
      io.emit('chat:message', {
        username: doc.username,
        text: doc.text,
        createdAt: doc.createdAt,
      });
    } catch (err) {
      console.error('Ошибка сохранения сообщения:', err);
    }
  });

  socket.on('disconnect', () => {
    console.log('Отключение:', socket.id);
    onlineUsersBySocket.delete(socket.id);
    io.emit('users:list', getOnlineUsernames());
  });
});

async function start() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('MongoDB подключена');

    server.listen(PORT, () => {
      console.log(`Сервер запущен (порт ${PORT})`);
    });
  } catch (err) {
    console.error('Не удалось подключиться к MongoDB:', err);
    process.exit(1);
  }
}

start();


