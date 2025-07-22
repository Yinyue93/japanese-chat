const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*", // Allow all origins - you can restrict this to your domain
    methods: ["GET", "POST"],
    allowedHeaders: ["content-type"],
    credentials: false
  },
  transports: ['websocket', 'polling'], // Try websocket first, fallback to polling
  allowEIO3: true, // Backward compatibility
  pingTimeout: 60000, // Increase timeout for slower connections
  pingInterval: 25000 // Heartbeat interval
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/sounds', express.static('sounds'));
app.use('/uploads', express.static('uploads'));

// Admin credentials
const ADMIN_ID = 'admin';
const ADMIN_PASSWORD = 'admin123';

// Data file paths
const ROOMS_FILE = path.join(__dirname, 'data', 'rooms.json');
const MESSAGES_FILE = path.join(__dirname, 'data', 'messages.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Configure multer for image uploads - use temporary storage first
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Use a temporary uploads directory first
    cb(null, UPLOADS_DIR);
  },
  filename: function (req, file, cb) {
    // Generate unique filename with timestamp
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'temp-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: function (req, file, cb) {
    // Only allow image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

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

// Helper function to delete room images
function deleteRoomImages(roomId) {
  const roomUploadDir = path.join(UPLOADS_DIR, roomId);
  if (fs.existsSync(roomUploadDir)) {
    try {
      // Delete all files in the room directory
      const files = fs.readdirSync(roomUploadDir);
      files.forEach(file => {
        fs.unlinkSync(path.join(roomUploadDir, file));
      });
      
      // Remove the empty directory
      fs.rmdirSync(roomUploadDir);
      console.log(`Deleted images for room ${roomId}`);
    } catch (error) {
      console.error(`Error deleting images for room ${roomId}:`, error);
    }
  }
}

// Store connected users
const connectedUsers = new Map();
const roomUsers = new Map();
const typingUsers = new Map(); // Store typing status for each room

// Room presence tracking - Map<roomId:userId, { count, logoutTimer }>
const roomPresence = new Map();

// Helper function to generate presence key
function getPresenceKey(roomId, userId) {
  return `${roomId}:${userId}`;
}

// Helper function to join room with presence tracking
function joinRoom(socket, roomId, userId) {
  console.log(`joinRoom called for ${userId} in room ${roomId}`);
  
  const presenceKey = getPresenceKey(roomId, userId);
  const currentPresence = roomPresence.get(presenceKey) || { count: 0, logoutTimer: null };
  
  // Check if there was a pending logout timer (indicates reconnection)
  const wasReconnecting = currentPresence.logoutTimer !== null;
  
  // Clear any pending logout timer
  if (currentPresence.logoutTimer) {
    console.log(`Clearing logout timer for ${userId} in room ${roomId} (reconnection detected)`);
    clearTimeout(currentPresence.logoutTimer);
    currentPresence.logoutTimer = null;
  }
  
  // Increment presence count
  currentPresence.count++;
  roomPresence.set(presenceKey, currentPresence);
  
  console.log(`User ${userId} presence count in room ${roomId}: ${currentPresence.count}`);
  
  // Only broadcast login if this is the first presence AND not a reconnection
  if (currentPresence.count === 1 && !wasReconnecting) {
    console.log(`Broadcasting login for ${userId} in room ${roomId}`);
    // Get current room info for user count
    const rooms = readRooms();
    const room = rooms.find(r => r.id === roomId);
    const userCount = room ? room.users.length : 0;
    socket.to(roomId).emit('user-login', { username: userId, userCount });
  } else if (wasReconnecting) {
    console.log(`Skipping login broadcast for ${userId} in room ${roomId} - was reconnecting`);
  }
  
  // Join the socket room
  socket.join(roomId);
}

// Helper function to leave room with presence tracking
function leaveRoom(socket, roomId, userId) {
  console.log(`leaveRoom called for ${userId} in room ${roomId}`);
  
  handleLeave(roomId, userId);
  socket.leave(roomId);
}

// Helper function for explicit leave (immediate logout, no grace period)
function handleExplicitLeave(socket, roomId, userId) {
  console.log(`handleExplicitLeave called for ${userId} in room ${roomId}`);
  
  const presenceKey = getPresenceKey(roomId, userId);
  const currentPresence = roomPresence.get(presenceKey);
  
  if (currentPresence) {
    // Clear any existing logout timer
    if (currentPresence.logoutTimer) {
      clearTimeout(currentPresence.logoutTimer);
      currentPresence.logoutTimer = null;
    }
    
    // Immediately broadcast logout message
    const rooms = readRooms();
    const room = rooms.find(r => r.id === roomId);
    // Subtract 1 from userCount since this user is leaving
    const userCount = room ? Math.max(0, room.users.length - 1) : 0;
    console.log(`Broadcasting immediate logout for ${userId} in room ${roomId}`);
    io.to(roomId).emit('user-logout', { username: userId, userCount });
    
    // Clean up presence entry
    roomPresence.delete(presenceKey);
  }
  
  socket.leave(roomId);
}

// Common leave handling function
function handleLeave(roomId, userId) {
  const presenceKey = getPresenceKey(roomId, userId);
  const currentPresence = roomPresence.get(presenceKey);
  
  if (!currentPresence || currentPresence.count <= 0) {
    console.log(`No presence found for ${userId} in room ${roomId}`);
    return;
  }
  
  // Clear any existing logout timer
  if (currentPresence.logoutTimer) {
    clearTimeout(currentPresence.logoutTimer);
    currentPresence.logoutTimer = null;
  }
  
  // Decrement presence count
  currentPresence.count--;
  console.log(`User ${userId} presence count in room ${roomId}: ${currentPresence.count}`);
  
  if (currentPresence.count <= 0) {
    // Start 5-second logout timer
    console.log(`Starting logout timer for ${userId} in room ${roomId}`);
    currentPresence.logoutTimer = setTimeout(() => {
      console.log(`Broadcasting logout for ${userId} in room ${roomId}`);
      // Get current room info for user count
      const rooms = readRooms();
      const room = rooms.find(r => r.id === roomId);
      const userCount = room ? room.users.length : 0;
      io.to(roomId).emit('user-logout', { username: userId, userCount });
      
      // Clean up presence entry
      roomPresence.delete(presenceKey);
    }, 5000);
  }
  
  // Update the presence store
  roomPresence.set(presenceKey, currentPresence);
}

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

// Image upload endpoint
app.post('/api/upload-image', upload.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No image file provided' });
    }

    const { roomId, username } = req.body;
    
    if (!roomId || !username) {
      // Delete the uploaded file if roomId or username is missing
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, error: 'Room ID and username are required' });
    }

    // Verify the room exists
    const rooms = readRooms();
    const room = rooms.find(r => r.id === roomId);
    if (!room) {
      // Delete the uploaded file if room doesn't exist
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ success: false, error: 'Room not found' });
    }

    // Create room-specific directory if it doesn't exist
    const roomUploadDir = path.join(UPLOADS_DIR, roomId);
    if (!fs.existsSync(roomUploadDir)) {
      fs.mkdirSync(roomUploadDir, { recursive: true });
    }

    // Move file from temp location to room-specific directory
    const originalPath = req.file.path;
    const finalFilename = req.file.filename.replace('temp-', '');
    const finalPath = path.join(roomUploadDir, finalFilename);
    
    // Move the file
    fs.renameSync(originalPath, finalPath);

    const imageUrl = `/uploads/${roomId}/${finalFilename}`;
    
    res.json({ 
      success: true, 
      imageUrl,
      filename: finalFilename,
      originalname: req.file.originalname,
      size: req.file.size
    });
    
  } catch (error) {
    console.error('Image upload error:', error);
    
    // Clean up temporary file if it exists
    if (req.file && req.file.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupError) {
        console.error('Error cleaning up temp file:', cleanupError);
      }
    }
    
    res.status(500).json({ success: false, error: 'Image upload failed' });
  }
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

    // Use the new joinRoom helper for presence tracking (after user is added to room)
    joinRoom(socket, roomId, username);

    connectedUsers.set(socket.id, { username, roomId });
    
    if (!roomUsers.has(roomId)) {
      roomUsers.set(roomId, new Set());
    }
    roomUsers.get(roomId).add(socket.id);

    console.log(`User ${username} successfully joined room ${roomId}`);
    socket.emit('joined-room', { roomId, roomName: room.name, userCount: room.users.length });
    // Note: user-login/logout messages are now handled by presence tracking in joinRoom()

    // Send information about users already present in the room
    const presentUsers = [];
    for (const [presenceKey, presence] of roomPresence.entries()) {
      const [keyRoomId, userId] = presenceKey.split(':');
      if (keyRoomId === roomId && presence.count > 0 && userId !== username) {
        presentUsers.push(userId);
      }
    }
    if (presentUsers.length > 0) {
      socket.emit('users-already-present', { users: presentUsers });
    }

    // Send existing messages
    const messages = readMessages();
    const roomMessages = messages[roomId] || [];
    socket.emit('room-messages', roomMessages);
  });

  socket.on('send-message', (data) => {
    const { roomId, message, username, imageUrl, originalname } = data;
    
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

    // Add image data if present
    if (imageUrl) {
      messageData.imageUrl = imageUrl;
      messageData.originalname = originalname;
      messageData.type = 'image';
    } else {
      messageData.type = 'text';
    }

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
    const user = connectedUsers.get(socket.id);
    if (user) {
      const { username, roomId } = user;
      leaveRoom(socket, roomId, username);
    }
    handleUserLeave(socket);
  });

  socket.on('explicit-leave-room', () => {
    const user = connectedUsers.get(socket.id);
    if (user) {
      const { username, roomId } = user;
      handleExplicitLeave(socket, roomId, username);
    }
    handleUserLeave(socket, true); // Pass true to indicate explicit leave
  });

  socket.on('disconnect', () => {
    console.log('ユーザーが切断しました:', socket.id);
    const user = connectedUsers.get(socket.id);
    if (user) {
      const { username, roomId } = user;
      // Handle presence tracking for disconnect
      handleLeave(roomId, username);
    }
    handleUserLeave(socket, false); // Pass false to maintain grace period for disconnections
  });
});

function handleUserLeave(socket, isExplicitLeave = true) {
  const user = connectedUsers.get(socket.id);
  if (user) {
    const { username, roomId } = user;
    console.log(`User leaving: ${username} from room ${roomId}, explicit: ${isExplicitLeave}`);
    
    // Remove user from typing list when they leave
    if (typingUsers.has(roomId)) {
      typingUsers.get(roomId).delete(username);
      socket.to(roomId).emit('user-stopped-typing', { username });
    }
    
    // Remove from room users
    if (roomUsers.has(roomId)) {
      roomUsers.get(roomId).delete(socket.id);
      
      // If no more users in room, handle room deletion
      if (roomUsers.get(roomId).size === 0) {
        if (isExplicitLeave) {
          // Immediate deletion for explicit leave
          console.log(`Room ${roomId} is empty after explicit leave, deleting immediately...`);
          
          // Clear any existing timeout for this room
          if (global.roomDeletionTimeouts && global.roomDeletionTimeouts.has(roomId)) {
            clearTimeout(global.roomDeletionTimeouts.get(roomId));
            global.roomDeletionTimeouts.delete(roomId);
          }
          
          // Delete room immediately
          roomUsers.delete(roomId);
          
          const rooms = readRooms();
          const updatedRooms = rooms.filter(r => r.id !== roomId);
          writeRooms(updatedRooms);
          
          // Clear messages for deleted room
          const messages = readMessages();
          delete messages[roomId];
          writeMessages(messages);
          
          // Delete room images
          deleteRoomImages(roomId);
        } else {
          // Grace period for disconnection
          console.log(`Room ${roomId} is empty after disconnect, scheduling deletion in 10 seconds...`);
          
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
              
              // Delete room images
              deleteRoomImages(roomId);
            }
            
            // Remove timeout from tracking
            if (global.roomDeletionTimeouts) {
              global.roomDeletionTimeouts.delete(roomId);
            }
          }, 10000); // 10 second grace period
          
          global.roomDeletionTimeouts.set(roomId, timeout);
        }
      } else {
        // Update room user list (but don't emit user-left - presence tracking handles this)
        const rooms = readRooms();
        const room = rooms.find(r => r.id === roomId);
        if (room) {
          room.users = room.users.filter(u => u !== username);
          writeRooms(rooms);
          // Note: user-logout message with updated count will be sent by presence tracking system
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