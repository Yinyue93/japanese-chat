const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/sounds', express.static('sounds'));

// Admin credentials
const ADMIN_ID = 'admin';
const ADMIN_PASSWORD = 'admin123';

// Data file paths
const ROOMS_FILE = path.join(__dirname, 'data', 'rooms.json');
const MESSAGES_FILE = path.join(__dirname, 'data', 'messages.json');

// Helper functions for file operations
function readRooms() {
  try {
    const data = fs.readFileSync(ROOMS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
}

function writeRooms(rooms) {
  try {
    // Ensure directory exists
    const dir = path.dirname(ROOMS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Write with error handling
    fs.writeFileSync(ROOMS_FILE, JSON.stringify(rooms, null, 2));
  } catch (error) {
    console.error('Error writing rooms file:', error);
    throw error;
  }
}

function readMessages() {
  try {
    const data = fs.readFileSync(MESSAGES_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return {};
  }
}

function writeMessages(messages) {
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
}

// Store connected users
const connectedUsers = new Map();
const roomUsers = new Map();
const typingUsers = new Map(); // Store typing status for each room

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-login.html'));
});

app.get('/lounge', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'lounge.html'));
});

app.get('/create-room', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'create-room.html'));
});

app.get('/password-prompt', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'password-prompt.html'));
});

app.get('/room/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'room.html'));
});


// API Routes
app.post('/api/login', (req, res) => {
  const { username } = req.body;
  if (username && username.trim().length > 0) {
    res.json({ success: true });
  } else {
    res.json({ success: false, error: 'ユーザー名を入力してください' });
  }
});

app.post('/api/admin-login', (req, res) => {
  const { adminId, password } = req.body;
  if (adminId === ADMIN_ID && password === ADMIN_PASSWORD) {
    res.json({ success: true });
  } else {
    res.json({ success: false, error: '管理者IDまたはパスワードが間違っています' });
  }
});

app.get('/api/rooms', (req, res) => {
  const rooms = readRooms();
  res.json(rooms);
});

app.post('/api/create-room', (req, res) => {
  const { roomName, capacity, password } = req.body;
  
  if (!roomName || roomName.trim().length === 0) {
    return res.json({ success: false, error: '部屋名を入力してください' });
  }

  try {
    const rooms = readRooms();
    const roomId = Date.now().toString();
    const newRoom = {
      id: roomId,
      name: roomName.trim(),
      capacity: parseInt(capacity) || 10,
      password: password || null,
      users: [],
      createdAt: new Date().toISOString()
    };

    rooms.push(newRoom);
    writeRooms(rooms);
    
    console.log(`Room created: ${roomName} (ID: ${roomId})`);
    res.json({ success: true, roomId });
  } catch (error) {
    console.error('Error creating room:', error);
    res.json({ success: false, error: '部屋の作成に失敗しました' });
  }
});

app.post('/api/join-room', (req, res) => {
  const { roomId, password } = req.body;
  const rooms = readRooms();
  const room = rooms.find(r => r.id === roomId);

  if (!room) {
    return res.json({ success: false, error: '部屋が見つかりません' });
  }

  if (room.password && room.password !== password) {
    return res.json({ success: false, error: 'パスワードが間違っています' });
  }

  if (room.users.length >= room.capacity) {
    return res.json({ success: false, error: '部屋が満員です' });
  }

  res.json({ success: true });
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('ユーザーが接続しました:', socket.id);

  socket.on('join-room', (data) => {
    const { roomId, username } = data;
    console.log(`User ${username} joining room ${roomId}`);
    
    const rooms = readRooms();
    const room = rooms.find(r => r.id === roomId);

    if (!room) {
      console.log(`Room not found: ${roomId}`);
      socket.emit('join-room-error', { error: '部屋が見つかりません' });
      return;
    }

    if (room.users.length >= room.capacity) {
      console.log(`Room full: ${roomId} (${room.users.length}/${room.capacity})`);
      socket.emit('join-room-error', { error: '部屋が満員です' });
      return;
    }

    // Successfully join room
    socket.join(roomId);
    
    // Cancel any pending room deletion
    if (global.roomDeletionTimeouts && global.roomDeletionTimeouts.has(roomId)) {
      console.log(`Canceling scheduled deletion for room ${roomId} - user rejoining`);
      clearTimeout(global.roomDeletionTimeouts.get(roomId));
      global.roomDeletionTimeouts.delete(roomId);
    }
    
    if (!room.users.includes(username)) {
      room.users.push(username);
      writeRooms(rooms);
    }

    connectedUsers.set(socket.id, { username, roomId });
    
    if (!roomUsers.has(roomId)) {
      roomUsers.set(roomId, new Set());
    }
    roomUsers.get(roomId).add(socket.id);

    console.log(`User ${username} successfully joined room ${roomId}`);
    socket.emit('joined-room', { roomId, roomName: room.name });
    io.to(roomId).emit('user-joined', { username, userCount: room.users.length });

    // Send existing messages
    const messages = readMessages();
    const roomMessages = messages[roomId] || [];
    socket.emit('room-messages', roomMessages);
  });

  socket.on('send-message', (data) => {
    const { roomId, message, username } = data;
    
    // Validate user is in the room
    const user = connectedUsers.get(socket.id);
    if (!user || user.roomId !== roomId) {
      console.log(`User ${username} not properly joined to room ${roomId}`);
      socket.emit('message-error', { error: '部屋に参加していません' });
      return;
    }
    
    // Stop typing when sending a message
    if (typingUsers.has(roomId)) {
      typingUsers.get(roomId).delete(username);
      socket.to(roomId).emit('user-stopped-typing', { username });
    }
    
    const messageData = {
      username,
      message,
      timestamp: new Date().toISOString()
    };

    const messages = readMessages();
    if (!messages[roomId]) {
      messages[roomId] = [];
    }
    messages[roomId].push(messageData);
    writeMessages(messages);

    io.to(roomId).emit('new-message', messageData);
  });

  socket.on('typing', (data) => {
    const { roomId, username } = data;
    
    // Validate user is in the room
    const user = connectedUsers.get(socket.id);
    if (!user || user.roomId !== roomId) {
      return;
    }
    
    // Initialize typing users for room if not exists
    if (!typingUsers.has(roomId)) {
      typingUsers.set(roomId, new Set());
    }
    
    // Add user to typing list
    typingUsers.get(roomId).add(username);
    
    // Broadcast to other users in the room
    socket.to(roomId).emit('user-typing', { username });
  });

  socket.on('stop-typing', (data) => {
    const { roomId, username } = data;
    
    // Validate user is in the room
    const user = connectedUsers.get(socket.id);
    if (!user || user.roomId !== roomId) {
      return;
    }
    
    // Remove user from typing list
    if (typingUsers.has(roomId)) {
      typingUsers.get(roomId).delete(username);
    }
    
    // Broadcast to other users in the room
    socket.to(roomId).emit('user-stopped-typing', { username });
  });

  socket.on('leave-room', () => {
    handleUserLeave(socket);
  });

  socket.on('disconnect', () => {
    console.log('ユーザーが切断しました:', socket.id);
    handleUserLeave(socket);
  });
});

function handleUserLeave(socket) {
  const user = connectedUsers.get(socket.id);
  if (user) {
    const { username, roomId } = user;
    console.log(`User leaving: ${username} from room ${roomId}`);
    
    // Remove user from typing list when they leave
    if (typingUsers.has(roomId)) {
      typingUsers.get(roomId).delete(username);
      socket.to(roomId).emit('user-stopped-typing', { username });
    }
    
    // Remove from room users
    if (roomUsers.has(roomId)) {
      roomUsers.get(roomId).delete(socket.id);
      
      // If no more users in room, schedule room deletion with grace period
      if (roomUsers.get(roomId).size === 0) {
        console.log(`Room ${roomId} is empty, scheduling deletion in 10 seconds...`);
        
        // Clear any existing timeout for this room
        if (global.roomDeletionTimeouts && global.roomDeletionTimeouts.has(roomId)) {
          clearTimeout(global.roomDeletionTimeouts.get(roomId));
        }
        
        // Initialize timeouts Map if it doesn't exist
        if (!global.roomDeletionTimeouts) {
          global.roomDeletionTimeouts = new Map();
        }
        
        // Schedule room deletion after 10 seconds
        const timeout = setTimeout(() => {
          // Double-check the room is still empty
          if (!roomUsers.has(roomId) || roomUsers.get(roomId).size === 0) {
            console.log(`Deleting empty room after grace period: ${roomId}`);
            roomUsers.delete(roomId);
            
            const rooms = readRooms();
            const updatedRooms = rooms.filter(r => r.id !== roomId);
            writeRooms(updatedRooms);
            
            // Clear messages for deleted room
            const messages = readMessages();
            delete messages[roomId];
            writeMessages(messages);
          }
          
          // Remove timeout from tracking
          if (global.roomDeletionTimeouts) {
            global.roomDeletionTimeouts.delete(roomId);
          }
        }, 10000); // 10 second grace period
        
        global.roomDeletionTimeouts.set(roomId, timeout);
      } else {
        // Update room user list
        const rooms = readRooms();
        const room = rooms.find(r => r.id === roomId);
        if (room) {
          room.users = room.users.filter(u => u !== username);
          writeRooms(rooms);
          io.to(roomId).emit('user-left', { username, userCount: room.users.length });
        }
      }
    }
    
    connectedUsers.delete(socket.id);
    socket.leave(roomId);
  }
}

server.listen(PORT, () => {
  console.log(`サーバーが起動しました: http://localhost:${PORT}`);
}); 