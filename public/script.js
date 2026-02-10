// Клиентская логика мессенджера
// - один раз спрашиваем имя пользователя
// - подключаемся к Socket.io
// - отправляем сообщения и отображаем входящие

(() => {
  const messagesEl = document.getElementById('messages');
  const messageForm = document.getElementById('message-form');
  const messageInput = document.getElementById('message-input');
  const statusEl = document.getElementById('connection-status');
  const onlineUsersEl = document.getElementById('online-users');
  const onlineCountEl = document.getElementById('online-count');
  const usernameModal = document.getElementById('username-modal');
  const usernameInput = document.getElementById('username-input');
  const usernameSubmit = document.getElementById('username-submit');
  const currentUsernameLabel = document.getElementById('current-username');

  let socket = null;
  let username = null;

  // Автопрокрутка чата вниз
  function scrollToBottom() {
    if (!messagesEl) return;
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // Форматируем время в человекочитаемый вид (часы:минуты)
  function formatTime(timestamp) {
    const date = new Date(timestamp);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  // Рендер одного сообщения
  function renderMessage(msg) {
    if (!messagesEl || !msg) return;

    const author = msg.username || msg.user || 'Гость';
    const createdAt = msg.createdAt || msg.timestamp || Date.now();

    const wrapper = document.createElement('div');
    wrapper.classList.add('message');
    if (username && author === username) {
      wrapper.classList.add('message--own');
    } else {
      wrapper.classList.add('message--other');
    }

    const meta = document.createElement('div');
    meta.classList.add('message__meta');

    const userEl = document.createElement('div');
    userEl.classList.add('message__user');
    userEl.textContent = author;

    const timeEl = document.createElement('div');
    timeEl.classList.add('message__time');
    timeEl.textContent = formatTime(createdAt);

    meta.appendChild(userEl);
    meta.appendChild(timeEl);

    const textEl = document.createElement('div');
    textEl.classList.add('message__text');
    textEl.textContent = msg.text || '';

    wrapper.appendChild(meta);
    wrapper.appendChild(textEl);

    messagesEl.appendChild(wrapper);
  }

  function renderOnlineUsers(users) {
    if (!onlineUsersEl || !Array.isArray(users)) return;

    onlineUsersEl.innerHTML = '';

    if (!users.length) {
      const empty = document.createElement('div');
      empty.classList.add('chat-item');
      const name = document.createElement('div');
      name.classList.add('chat-item__name');
      name.textContent = 'Пока никого нет';
      empty.appendChild(name);
      onlineUsersEl.appendChild(empty);
    } else {
      users.forEach((name) => {
        const item = document.createElement('div');
        item.classList.add('chat-item');
        const nameEl = document.createElement('div');
        nameEl.classList.add('chat-item__name');
        nameEl.textContent = name;
        item.appendChild(nameEl);
        onlineUsersEl.appendChild(item);
      });
    }

    if (onlineCountEl) {
      onlineCountEl.textContent = String(users.length);
    }
  }

  function setStatus(text, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.style.color = isError ? '#f97373' : '#9ca3af';
  }

  // Запуск соединения с сервером
  function initSocket() {
    socket = io();

    socket.on('connect', () => {
      setStatus('В сети');
      if (username) {
        socket.emit('user:join', { username });
      }
    });

    socket.on('disconnect', () => {
      setStatus('Отключено', true);
    });

    socket.on('user:accepted', (data) => {
      if (!data || !data.username) return;
      username = data.username;
      currentUsernameLabel.textContent = username;
      try {
        window.localStorage.setItem('chat-username', username);
      } catch (_) {}
    });

    socket.on('users:list', (users) => {
      renderOnlineUsers(users);
    });

    // Инициализация истории сообщений
    socket.on('chat:init', (history) => {
      messagesEl.innerHTML = '';
      if (Array.isArray(history)) {
        history.forEach((m) => renderMessage(m));
      }
      scrollToBottom();
    });

    // Новое сообщение
    socket.on('chat:message', (msg) => {
      renderMessage(msg);
      scrollToBottom();
    });
  }

  function trySendMessage() {
    if (!socket || !username) return;
    const text = messageInput.value.trim();
    if (!text) return;

    socket.emit('chat:message', {
      user: username,
      text,
    });

    messageInput.value = '';
    messageInput.style.height = 'auto';
  }

  // Авто-увеличение высоты textarea
  function autoResizeTextarea() {
    messageInput.style.height = 'auto';
    const maxHeight = 120;
    messageInput.style.height = Math.min(messageInput.scrollHeight, maxHeight) + 'px';
  }

  // Обработчики ввода имени пользователя
  function openUsernameModal() {
    usernameModal.classList.remove('username-modal--hidden');
    usernameInput.focus();
  }

  function applyUsername() {
    const value = usernameInput.value.trim();
    if (!value) {
      usernameInput.focus();
      return;
    }
    username = value.slice(0, 32);
    usernameModal.classList.add('username-modal--hidden');
    currentUsernameLabel.textContent = username;

    // Запоминаем имя на случай перезагрузки
    try {
      window.localStorage.setItem('chat-username', username);
    } catch (_) {}

    // Подключаемся к сокету только после того, как знаем имя
    if (!socket) {
      initSocket();
    } else {
      socket.emit('user:join', { username });
    }
  }

  // Инициализация
  window.addEventListener('DOMContentLoaded', () => {
    // Попытаемся прочитать имя из localStorage
    try {
      const stored = window.localStorage.getItem('chat-username');
      if (stored && stored.trim()) {
        username = stored.trim().slice(0, 32);
        currentUsernameLabel.textContent = username;
        usernameModal.classList.add('username-modal--hidden');
        initSocket();
      } else {
        openUsernameModal();
      }
    } catch (e) {
      openUsernameModal();
    }

    // События формы выбора имени
    usernameSubmit.addEventListener('click', applyUsername);
    usernameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyUsername();
      }
    });

    // События формы отправки сообщения
    messageForm.addEventListener('submit', (e) => {
      e.preventDefault();
      trySendMessage();
    });

    messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        trySendMessage();
      }
    });

    messageInput.addEventListener('input', autoResizeTextarea);
  });
})();


