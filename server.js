// Сервер веб-мессенджера
// - Express раздаёт статику из /public
// - Socket.io обеспечивает обмен в реальном времени
// - MongoDB (через mongoose) хранит историю сообщений
// - Онлайн-пользователи отслеживаются в памяти (socket.id -> username)
// - Есть одна роль модератора с расширенными правами

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const sqlite3 = require('sqlite3').verbose();

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
const SQLITE_PATH = process.env.SQLITE_PATH || path.join(__dirname, 'users.db');

if (!MONGO_URI) {
  console.error('Ошибка: не задана переменная окружения MONGO_URI');
  console.error('Создайте .env (локально) или задайте MONGO_URI на хостинге.');
  process.exit(1);
}

// Имя модератора (зарезервированный ник)
const MODERATOR_USERNAME = process.env.MODERATOR_USERNAME || 'Модератор';

// Состояние группы (название и аватар)
const groupState = {
  name: process.env.GROUP_NAME || 'Общий чат',
  avatarUrl: process.env.GROUP_AVATAR_URL || '',
};

// Текущее подключение модератора
let moderatorSocketId = null;

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

function sanitizeGroupName(value) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 64);
}

function sanitizeAvatarUrl(value) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 256);
}

function isModerator(socket) {
  return !!socket.data.isModerator;
}


let usersDb = null;

function runSql(query, params = []) {
  return new Promise((resolve, reject) => {
    usersDb.run(query, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function getSql(query, params = []) {
  return new Promise((resolve, reject) => {
    usersDb.get(query, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

async function ensureUsersTable() {
  await runSql(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nickname TEXT UNIQUE,
      rank TEXT
    )
  `);
}

async function saveOrGetUser(nickname) {
  const existingUser = await getSql(
    'SELECT nickname, rank FROM users WHERE nickname = ?',
    [nickname]
  );

  if (existingUser) {
    return {
      nickname: existingUser.nickname,
      rank: existingUser.rank || 'Игрок',
    };
  }

  await runSql('INSERT INTO users (nickname, rank) VALUES (?, ?)', [
    nickname,
    'Игрок',
  ]);

  return { nickname, rank: 'Игрок' };
}

app.use(express.json());

app.post('/api/users/login', async (req, res) => {
  try {
    const nickname = sanitizeUsername(req.body?.nickname);
    if (!nickname) {
      return res.status(400).json({ error: 'Никнейм обязателен' });
    }

    const user = await saveOrGetUser(nickname);
    return res.json(user);
  } catch (err) {
    console.error('Ошибка сохранения пользователя:', err);
    return res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Раздаём статику из папки public
app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  console.log('Новое подключение:', socket.id);

  // Клиент должен сообщить имя после открытия страницы
  socket.on('user:join', async (data) => {
    const rawName = sanitizeUsername(data?.username);
    if (!rawName) return;

    // Проверяем, пытается ли пользователь взять ник модератора
    let isMod = false;
    if (rawName === MODERATOR_USERNAME) {
      if (!moderatorSocketId || moderatorSocketId === socket.id) {
        isMod = true;
        moderatorSocketId = socket.id;
      } else {
        socket.emit('user:error', { message: 'Этот ник занят' });
        return;
      }
    }

    const finalName = isMod ? MODERATOR_USERNAME : makeUniqueUsername(rawName);

    socket.data.username = finalName;
    socket.data.isModerator = isMod;
    onlineUsersBySocket.set(socket.id, finalName);

    // Подтверждаем имя (если пришлось сделать уникальным) и роль
    socket.emit('user:accepted', { username: finalName, isModerator: isMod });

    // Отправляем текущее состояние группы
    socket.emit('group:state', {
      name: groupState.name,
      avatarUrl: groupState.avatarUrl,
      moderatorName: MODERATOR_USERNAME,
    });

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

    // Модератору менять ник не даём (чтобы не терять роль)
    if (isModerator(socket)) {
      socket.emit('user:error', { message: 'Модератор не может менять ник' });
      return;
    }

    // Обычный пользователь не может взять ник модератора
    if (rawName === MODERATOR_USERNAME) {
      socket.emit('user:error', { message: 'Этот ник занят' });
      return;
    }

    const finalName = makeUniqueUsername(rawName);
    socket.data.username = finalName;
    onlineUsersBySocket.set(socket.id, finalName);

    // Подтверждаем новое имя конкретному пользователю
    socket.emit('user:accepted', { username: finalName, isModerator: false });
    // Рассылаем обновлённый список онлайн-пользователей всем
    io.emit('users:list', getOnlineUsernames());
  });

  // Обработка входящего сообщения
  socket.on('chat:message', async (data) => {
    const user = sanitizeUsername(socket.data.username);
    const text = sanitizeText(data?.text);
    if (!user || !text) return;

    // Команда очистки чата (только модератор)
    if (text === '/clear' && isModerator(socket)) {
      try {
        await Message.deleteMany({});
        io.emit('chat:clear');
      } catch (err) {
        console.error('Ошибка при очистке чата:', err);
      }
      return;
    }

    try {
      const doc = await Message.create({ username: user, text });

      // Отправляем сообщение всем подключённым клиентам
      io.emit('chat:message', {
        id: String(doc._id),
        username: doc.username,
        text: doc.text,
        createdAt: doc.createdAt,
      });
    } catch (err) {
      console.error('Ошибка сохранения сообщения:', err);
    }
  });

  // Удаление отдельного сообщения (только модератор)
  socket.on('chat:deleteMessage', async (data) => {
    if (!isModerator(socket)) return;
    const id = data?.id;
    if (!id) return;

    try {
      await Message.findByIdAndDelete(id);
      io.emit('chat:deleteMessage', { id });
    } catch (err) {
      console.error('Ошибка удаления сообщения:', err);
    }
  });

  // Полная очистка чата по явной команде (альтернатива /clear)
  socket.on('chat:clear', async () => {
    if (!isModerator(socket)) return;
    try {
      await Message.deleteMany({});
      io.emit('chat:clear');
    } catch (err) {
      console.error('Ошибка при очистке чата:', err);
    }
  });

  // Обновление названия группы (только модератор)
  socket.on('group:updateName', (data) => {
    if (!isModerator(socket)) return;
    const name = sanitizeGroupName(data?.name);
    if (!name) return;
    groupState.name = name;
    io.emit('group:updateName', { name });
  });

  // Обновление аватарки группы (только модератор)
  socket.on('group:updateAvatar', (data) => {
    if (!isModerator(socket)) return;
    const url = sanitizeAvatarUrl(data?.avatarUrl);
    groupState.avatarUrl = url;
    io.emit('group:updateAvatar', { avatarUrl: url });
  });

  // Назначение/снятие модератора другим пользователям
  socket.on('admin:setModerator', (data) => {
    if (!isModerator(socket)) return;
    const targetName = sanitizeUsername(data?.username);
    if (!targetName) return;

    io.sockets.sockets.forEach((s) => {
      if (!s.data || s.data.username !== targetName) return;

      // Нельзя снять модератора с самого себя через эту команду,
      // чтобы случайно не потерять все права
      if (s.id === socket.id) {
        return;
      }

      const next = !s.data.isModerator;
      s.data.isModerator = next;

      // Если мы назначаем модератором пользователя с зарезервированным ником,
      // и ник совпадает с MODERATOR_USERNAME, обновляем главный идентификатор
      if (next && s.data.username === MODERATOR_USERNAME) {
        moderatorSocketId = s.id;
      }

      s.emit('user:accepted', {
        username: s.data.username,
        isModerator: next,
      });
    });

    io.emit('users:list', getOnlineUsernames());
  });

  // Принудительное изменение ника другого пользователя модератором
  socket.on('admin:renameUser', (data) => {
    if (!isModerator(socket)) return;

    const oldName = sanitizeUsername(data?.oldUsername);
    const rawNew = sanitizeUsername(data?.newUsername);
    if (!oldName || !rawNew) return;

    // Запрещаем назначать ник модератора, если он уже занят другим
    if (rawNew === MODERATOR_USERNAME && moderatorSocketId) {
      const currentModName = onlineUsersBySocket.get(moderatorSocketId);
      if (currentModName && currentModName !== oldName) {
        socket.emit('user:error', { message: 'Этот ник занят' });
        return;
      }
    }

    const finalName = makeUniqueUsername(rawNew);

    io.sockets.sockets.forEach((s) => {
      if (!s.data || s.data.username !== oldName) return;

      const wasModerator = !!s.data.isModerator;
      const prevName = s.data.username;

      s.data.username = finalName;
      onlineUsersBySocket.set(s.id, finalName);

      // Если переименовали основного модератора с зарезервированным ником,
      // освобождаем главный идентификатор
      if (wasModerator && prevName === MODERATOR_USERNAME && s.id === moderatorSocketId && finalName !== MODERATOR_USERNAME) {
        moderatorSocketId = null;
      }

      s.emit('user:accepted', {
        username: finalName,
        isModerator: wasModerator,
      });
    });

    io.emit('users:list', getOnlineUsernames());
  });

  socket.on('disconnect', () => {
    console.log('Отключение:', socket.id);
    if (socket.data.isModerator && moderatorSocketId === socket.id) {
      moderatorSocketId = null;
    }
    onlineUsersBySocket.delete(socket.id);
    io.emit('users:list', getOnlineUsernames());
  });
});

async function start() {
  try {
    usersDb = new sqlite3.Database(SQLITE_PATH);
    await ensureUsersTable();
    console.log(`SQLite подключена (${SQLITE_PATH})`);

    await mongoose.connect(MONGO_URI);
    console.log('MongoDB подключена');

    server.listen(PORT, () => {
      console.log(`Сервер запущен (порт ${PORT})`);
    });
  } catch (err) {
    console.error('Не удалось запустить сервер:', err);
    process.exit(1);
  }
}

start();


