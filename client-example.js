/**
 * مثال على استخدام نظام الدردشة - جانب العميل
 * يمكن استخدام هذا المثال مع React, Vue, Angular, أو vanilla JavaScript
 */

import io from 'socket.io-client';

class ChatApplication {
  constructor(serverUrl = 'http://localhost:1001') {
    this.socket = io(serverUrl);
    this.currentUser = null;
    this.usersOnline = [];
    this.messages = [];
    this.typingUsers = new Set();
    this.setupEventListeners();
  }

  /**
   * إعداد مستمعي الأحداث
   */
  setupEventListeners() {
    // الاتصال بالسيرفر
    this.socket.on('connect', () => {
      console.log('✅ متصل بنجاح بالسيرفر');
    });

    // استقبال قائمة المستخدمين المتصلين
    this.socket.on('users_list', (users) => {
      this.usersOnline = users;
      console.log('👥 المستخدمون المتصلون:', users.length);
      this.updateUsersList();
    });

    // مستخدم انضم
    this.socket.on('user_joined', (data) => {
      console.log('✅ ' + data.message);
      this.displaySystemMessage(data.message);
    });

    // استقبال رسالة جديدة
    this.socket.on('receive_message', (message) => {
      console.log('💬 رسالة جديدة من ' + message.user.name);
      this.messages.push(message);
      this.displayMessage(message);
    });

    // مستخدم يكتب
    this.socket.on('user_typing', (data) => {
      this.typingUsers.add(data.userId);
      this.displayTypingIndicator(data.name);
    });

    // توقف الكتابة
    this.socket.on('user_stop_typing', (data) => {
      this.typingUsers.delete(data.userId);
      this.hideTypingIndicator(data.userId);
    });

    // رسالة تم حذفها
    this.socket.on('message_deleted', (data) => {
      this.messages = this.messages.filter(m => m.id !== data.messageId);
      console.log('🗑️ تم حذف الرسالة');
      this.refreshMessages();
    });

    // رسالة تم تحديثها
    this.socket.on('message_updated', (message) => {
      const index = this.messages.findIndex(m => m.id === message.id);
      if (index !== -1) {
        this.messages[index] = message;
      }
      console.log('✏️ تم تحديث الرسالة');
      this.refreshMessages();
    });

    // مستخدم غادر
    this.socket.on('user_left', (data) => {
      console.log('❌ ' + data.message);
      this.displaySystemMessage(data.message);
    });

    // الأخطاء
    this.socket.on('error', (error) => {
      console.error('❌ خطأ:', error.message);
      this.displayError(error.message);
    });

    // قطع الاتصال
    this.socket.on('disconnect', () => {
      console.log('❌ تم قطع الاتصال بالسيرفر');
      this.displaySystemMessage('تم قطع الاتصال بالسيرفر');
    });
  }

  /**
   * الاتصال والانضمام إلى الغرفة
   */
  connectToChat(userData) {
    this.currentUser = userData;
    
    // إرسال بيانات المستخدم للسيرفر
    this.socket.emit('user_connected', {
      userId: userData.id,
      name: userData.name,
      image: userData.image,
      position: userData.position,
      role: userData.role
    });

    console.log('🔗 تم الاتصال بـ:', userData.name);
  }

  /**
   * إرسال رسالة
   */
  sendMessage(content) {
    if (!content.trim()) {
      console.warn('لا يمكن إرسال رسالة فارغة');
      return;
    }

    this.socket.emit('send_message', {
      userId: this.currentUser.id,
      content: content,
      room: 'main_chat'
    });

    // إشعار بانتهاء الكتابة
    this.stopTyping();
  }

  /**
   * إشعار بالكتابة
   */
  startTyping() {
    this.socket.emit('user_typing', {
      userId: this.currentUser.id,
      name: this.currentUser.name
    });
  }

  /**
   * توقف الكتابة
   */
  stopTyping() {
    this.socket.emit('user_stop_typing', {
      userId: this.currentUser.id
    });
  }

  /**
   * حذف رسالة
   */
  deleteMessage(messageId) {
    this.socket.emit('delete_message', {
      messageId: messageId
    });
  }

  /**
   * تحديث رسالة
   */
  updateMessage(messageId, newContent) {
    this.socket.emit('update_message', {
      messageId: messageId,
      content: newContent
    });
  }

  /**
   * جلب الرسائل السابقة من REST API
   */
  async fetchPreviousMessages(limit = 50) {
    try {
      const response = await fetch(
        `http://localhost:1001/api/chat/messages?room=main_chat&limit=${limit}`
      );
      const data = await response.json();
      if (data.success) {
        this.messages = data.messages;
        this.refreshMessages();
        console.log('✅ تم جلب الرسائل السابقة');
      }
    } catch (error) {
      console.error('❌ فشل في جلب الرسائل:', error);
    }
  }

  /**
   * عرض الرسالة (واجهة المستخدم)
   */
  displayMessage(message) {
    const messageElement = document.createElement('div');
    messageElement.className = 'message';
    messageElement.setAttribute('data-message-id', message.id);
    
    const isCurrentUser = message.user.id === this.currentUser.id;
    
    messageElement.innerHTML = `
      <div class="message-content ${isCurrentUser ? 'current-user' : 'other-user'}">
        <div class="message-header">
          <img src="${message.user.image}" alt="${message.user.name}" class="user-avatar">
          <div class="user-info">
            <strong>${message.user.name}</strong>
            <span class="user-position">${message.user.position}</span>
          </div>
          <span class="message-time">${new Date(message.createdAt).toLocaleTimeString('ar-SA')}</span>
        </div>
        <div class="message-text">${this.escapeHtml(message.content)}</div>
        ${isCurrentUser ? `
          <div class="message-actions">
            <button class="edit-btn" onclick="chat.editMessage(${message.id})">تعديل</button>
            <button class="delete-btn" onclick="chat.deleteMessage(${message.id})">حذف</button>
          </div>
        ` : ''}
      </div>
    `;
    
    document.getElementById('messages-container').appendChild(messageElement);
    this.scrollToBottom();
  }

  /**
   * عرض رسالة نظام
   */
  displaySystemMessage(message) {
    const messageElement = document.createElement('div');
    messageElement.className = 'system-message';
    messageElement.textContent = message;
    document.getElementById('messages-container').appendChild(messageElement);
    this.scrollToBottom();
  }

  /**
   * عرض مؤشر الكتابة
   */
  displayTypingIndicator(userName) {
    let typingIndicator = document.getElementById('typing-indicator');
    if (!typingIndicator) {
      typingIndicator = document.createElement('div');
      typingIndicator.id = 'typing-indicator';
      typingIndicator.className = 'typing-indicator';
      document.getElementById('messages-container').appendChild(typingIndicator);
    }
    typingIndicator.textContent = userName + ' يكتب...';
  }

  /**
   * إخفاء مؤشر الكتابة
   */
  hideTypingIndicator(userId) {
    if (this.typingUsers.size === 0) {
      const typingIndicator = document.getElementById('typing-indicator');
      if (typingIndicator) {
        typingIndicator.remove();
      }
    }
  }

  /**
   * تحديث قائمة المستخدمين المتصلين
   */
  updateUsersList() {
    const usersList = document.getElementById('users-list');
    usersList.innerHTML = '';
    
    this.usersOnline.forEach(user => {
      const userElement = document.createElement('div');
      userElement.className = 'user-online';
      userElement.innerHTML = `
        <img src="${user.image}" alt="${user.name}" class="user-avatar">
        <div class="user-details">
          <strong>${user.name}</strong>
          <small>${user.position}</small>
        </div>
        <span class="online-indicator"></span>
      `;
      usersList.appendChild(userElement);
    });
  }

  /**
   * تنديد الرسائل
   */
  refreshMessages() {
    const container = document.getElementById('messages-container');
    container.innerHTML = '';
    this.messages.forEach(msg => this.displayMessage(msg));
  }

  /**
   * تمرير الشاشة للأسفل
   */
  scrollToBottom() {
    const container = document.getElementById('messages-container');
    container.scrollTop = container.scrollHeight;
  }

  /**
   * عرض الأخطاء
   */
  displayError(error) {
    const errorElement = document.createElement('div');
    errorElement.className = 'error-message';
    errorElement.textContent = '❌ ' + error;
    document.getElementById('messages-container').appendChild(errorElement);
  }

  /**
   * تجنب XSS
   */
  escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }

  /**
   * تعديل رسالة
   */
  editMessage(messageId) {
    const newContent = prompt('عدّل الرسالة:');
    if (newContent) {
      this.updateMessage(messageId, newContent);
    }
  }
}

// إنشاء كائن الدردشة
let chat;

// عند تحميل الصفحة
window.addEventListener('DOMContentLoaded', () => {
  chat = new ChatApplication();

  // الاتصال برسالة بيانات المستخدم الحالي
  const currentUser = {
    id: 1,
    name: 'أحمد محمد',
    image: 'https://example.com/avatar.jpg',
    position: 'CF',
    role: 'user'
  };

  chat.connectToChat(currentUser);
  chat.fetchPreviousMessages();

  // معالجة إرسال الرسالة
  document.getElementById('send-btn').addEventListener('click', () => {
    const input = document.getElementById('message-input');
    chat.sendMessage(input.value);
    input.value = '';
  });

  // معالجة الضغط على Enter
  document.getElementById('message-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      document.getElementById('send-btn').click();
    }
  });

  // إشعار بالكتابة
  document.getElementById('message-input').addEventListener('input', () => {
    chat.startTyping();
  });

  document.getElementById('message-input').addEventListener('blur', () => {
    chat.stopTyping();
  });
});

export default ChatApplication;
