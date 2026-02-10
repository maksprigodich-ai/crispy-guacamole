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
  const onlinePanel = document.getElementById('online-panel-mobile');
  const onlinePanelBackdrop = document.getElementById('online-panel-backdrop');
  const onlinePanelClose = document.getElementById('online-panel-close');
  const onlineUsersMobileEl = document.getElementById('online-users-mobile');
  const onlineCountMobileEl = document.getElementById('online-count-mobile');
  const onlineToggleBtn = document.getElementById('online-toggle-btn');
  const usernameModal = document.getElementById('username-modal');
  const usernameInput = document.getElementById('username-input');
  const usernameSubmit = document.getElementById('username-submit');
  const currentUsernameLabel = document.getElementById('current-username');
  const changeUsernameBtn = document.getElementById('change-username-btn');
  const changeUsernameForm = document.getElementById('change-username-form');
  const changeUsernameInput = document.getElementById('change-username-input');
  const changeUsernameSave = document.getElementById('change-username-save');
  const groupNameEl = document.getElementById('group-name');
  const groupAvatarEl = document.getElementById('group-avatar');
  const groupEditNameBtn = document.getElementById('group-edit-name-btn');
  const groupEditAvatarBtn = document.getElementById('group-edit-avatar-btn');
  const chatClearBtn = document.getElementById('chat-clear-btn');

  let socket = null;
  let username = null;
  let isModerator = false;
  let moderatorName = null;

  // Проверяем, находится ли пользователь внизу чата
  function isAtBottom() {
    if (!messagesEl) return true;
    const distanceFromBottom =
      messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
    // Считаем, что "внизу", только если практически упёрлись в конец
    return distanceFromBottom <= 2;
  }

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
    if (msg.id) {
      wrapper.dataset.id = String(msg.id);
    }
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

    // Кнопка удаления сообщения (только для модератора)
    if (isModerator && msg.id) {
      const deleteBtn = document.createElement('button');
      deleteBtn.classList.add('message__delete-btn');
      deleteBtn.textContent = '×';
      deleteBtn.title = 'Удалить сообщение';
      deleteBtn.addEventListener('click', () => {
        if (socket) {
          socket.emit('chat:deleteMessage', { id: msg.id });
        }
      });
      wrapper.appendChild(deleteBtn);
    }

    messagesEl.appendChild(wrapper);
  }

  function renderOnlineList(targetEl, users) {
    if (!targetEl) return;
    targetEl.innerHTML = '';

    if (!Array.isArray(users) || !users.length) {
      const empty = document.createElement('div');
      empty.classList.add('chat-item');
      const name = document.createElement('div');
      name.classList.add('chat-item__name');
      name.textContent = 'Пока никого нет';
      empty.appendChild(name);
      targetEl.appendChild(empty);
      return;
    }

    users.forEach((name) => {
      const item = document.createElement('div');
      item.classList.add('chat-item');
      const nameEl = document.createElement('div');
      nameEl.classList.add('chat-item__name');
      nameEl.textContent = name;
      item.appendChild(nameEl);

      // Управление пользователями (только для модератора, по клику)
      if (isModerator && name !== username) {
        item.classList.add('chat-item--clickable');
        item.addEventListener('click', () => {
          if (!socket) return;
          const action = prompt(
            `Действие над пользователем "${name}":\n1 — сделать/снять модератора\n2 — изменить ник\n\nВведите 1 или 2`
          );
          if (action === '1') {
            socket.emit('admin:setModerator', { username: name });
          } else if (action === '2') {
            const next = prompt('Новый ник для пользователя', name);
            if (!next || !next.trim()) return;
            socket.emit('admin:renameUser', {
              oldUsername: name,
              newUsername: next.trim(),
            });
          }
        });
      }

      targetEl.appendChild(item);
    });
  }

  function renderOnlineUsers(users) {
    renderOnlineList(onlineUsersEl, users);
    renderOnlineList(onlineUsersMobileEl, users);

    const count = Array.isArray(users) ? users.length : 0;
    if (onlineCountEl) {
      onlineCountEl.textContent = String(count);
    }
    if (onlineCountMobileEl) {
      onlineCountMobileEl.textContent = String(count);
    }
  }

  function applyGroupState(state) {
    if (!state) return;
    if (state.name && groupNameEl) {
      groupNameEl.textContent = state.name;
    }
    if (groupAvatarEl) {
      if (state.avatarUrl) {
        groupAvatarEl.style.backgroundImage = `url(${state.avatarUrl})`;
      } else {
        groupAvatarEl.style.backgroundImage = '';
      }
    }
    if (state.moderatorName) {
      moderatorName = state.moderatorName;
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
      isModerator = !!data.isModerator;
      currentUsernameLabel.textContent = username;
      document.body.classList.toggle('is-moderator', isModerator);
      try {
        window.localStorage.setItem('chat-username', username);
      } catch (_) {}
    });

    socket.on('user:error', (data) => {
      if (data && data.message) {
        alert(data.message);
      }
    });

    socket.on('users:list', (users) => {
      renderOnlineUsers(users);
    });

    socket.on('group:state', (state) => {
      applyGroupState(state);
    });

    socket.on('group:updateName', (data) => {
      applyGroupState({ name: data?.name });
    });

    socket.on('group:updateAvatar', (data) => {
      applyGroupState({ avatarUrl: data?.avatarUrl });
    });

    // Инициализация истории сообщений
    socket.on('chat:init', (history) => {
      messagesEl.innerHTML = '';
      if (Array.isArray(history)) {
        history.forEach((m) => renderMessage(m));
      }
      // При первичной загрузке всегда прокручиваем в самый низ
      scrollToBottom();
    });

    // Новое сообщение
    socket.on('chat:message', (msg) => {
      const wasAtBottom = isAtBottom();
      renderMessage(msg);
      // Прокручиваем только если пользователь был внизу до прихода сообщения
      if (wasAtBottom) {
        scrollToBottom();
      }
    });

    socket.on('chat:deleteMessage', (data) => {
      const id = data?.id;
      if (!id || !messagesEl) return;
      const node = messagesEl.querySelector(`[data-id="${id}"]`);
      if (node && node.parentNode) {
        node.parentNode.removeChild(node);
      }
    });

    socket.on('chat:clear', () => {
      if (messagesEl) {
        messagesEl.innerHTML = '';
      }
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

  function openInlineUsernameEditor() {
    if (!changeUsernameForm || !changeUsernameInput) return;
    changeUsernameForm.classList.remove('sidebar__change-form--hidden');
    changeUsernameInput.value = username || '';
    changeUsernameInput.focus();
    changeUsernameInput.select();
  }

  function closeInlineUsernameEditor() {
    if (!changeUsernameForm) return;
    changeUsernameForm.classList.add('sidebar__change-form--hidden');
  }

  function applyInlineUsername() {
    if (!changeUsernameInput) return;
    const value = changeUsernameInput.value.trim();
    if (!value) {
      closeInlineUsernameEditor();
      return;
    }

    const nextName = value.slice(0, 32);
    if (nextName === username) {
      closeInlineUsernameEditor();
      return;
    }

    // Отправляем запрос на обновление имени на сервере,
    // локально имя обновится после события user:accepted
    if (socket) {
      socket.emit('user:updateName', { username: nextName });
    }

    closeInlineUsernameEditor();
  }

  function openOnlinePanel() {
    if (!onlinePanel) return;
    onlinePanel.classList.remove('online-panel-mobile--hidden');
  }

  function closeOnlinePanel() {
    if (!onlinePanel) return;
    onlinePanel.classList.add('online-panel-mobile--hidden');
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

    // Смена ника в футере
    if (changeUsernameBtn) {
      changeUsernameBtn.addEventListener('click', () => {
        if (!username) {
          openUsernameModal();
          return;
        }
        openInlineUsernameEditor();
      });
    }

    if (changeUsernameSave) {
      changeUsernameSave.addEventListener('click', applyInlineUsername);
    }

    if (changeUsernameInput) {
      changeUsernameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          applyInlineUsername();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          closeInlineUsernameEditor();
        }
      });
      changeUsernameInput.addEventListener('blur', () => {
        // Лёгкий UX: при потере фокуса просто скрываем форму без изменения
        setTimeout(() => {
          closeInlineUsernameEditor();
        }, 100);
      });
    }

    // Мобильная панель онлайн-пользователей
    if (onlineToggleBtn) {
      onlineToggleBtn.addEventListener('click', openOnlinePanel);
    }
    if (onlinePanelClose) {
      onlinePanelClose.addEventListener('click', closeOnlinePanel);
    }
    if (onlinePanelBackdrop) {
      onlinePanelBackdrop.addEventListener('click', closeOnlinePanel);
    }

    // Управление группой (только модератор, отображение контролируется CSS)
    if (groupEditNameBtn) {
      groupEditNameBtn.addEventListener('click', () => {
        if (!socket) return;
        const current = groupNameEl ? groupNameEl.textContent || '' : '';
        const next = prompt('Новое название группы', current);
        if (!next || !next.trim()) return;
        socket.emit('group:updateName', { name: next.trim() });
      });
    }

    if (groupEditAvatarBtn) {
      groupEditAvatarBtn.addEventListener('click', () => {
        if (!socket) return;
        const current =
          (groupAvatarEl && groupAvatarEl.style.backgroundImage) || '';
        const next = prompt(
          'URL аватарки группы (PNG/JPG), оставьте пустым чтобы убрать',
          current.replace(/^url\(["']?|["']?\)$/g, '')
        );
        if (next === null) return;
        const trimmed = next.trim();
        socket.emit('group:updateAvatar', { avatarUrl: trimmed });
      });
    }

    if (chatClearBtn) {
      chatClearBtn.addEventListener('click', () => {
        if (!socket) return;
        if (confirm('Очистить чат для всех пользователей?')) {
          socket.emit('chat:clear');
        }
      });
    }
  });
})();


