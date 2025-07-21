const io = require('socket.io-client');
const http = require('http');

console.log('🧪 Testing Typing Indicators...\n');

// Configuration
const SERVER_URL = process.argv[2] || 'http://localhost:3000';
const USER1_NAME = 'TestUser1';
const USER2_NAME = 'TestUser2';

console.log(`📡 Server URL: ${SERVER_URL}`);
console.log(`👤 Test Users: ${USER1_NAME}, ${USER2_NAME}\n`);

// Track test results
let testResults = {
  connection: false,
  roomCreated: false,
  roomJoin: false,
  typingReceived: false,
  stopTypingReceived: false
};

let TEST_ROOM_ID = null;
let socket1, socket2;

// Function to create a room first
function createRoom() {
  console.log('🏠 Creating test room...');
  
  const postData = JSON.stringify({
    roomName: `Test Room ${Date.now()}`,
    capacity: 10,
    password: null
  });
  
  const url = new URL('/api/create-room', SERVER_URL);
  const options = {
    hostname: url.hostname,
    port: url.port,
    path: url.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  };
  
  const req = http.request(options, (res) => {
    let data = '';
    
    res.on('data', (chunk) => {
      data += chunk;
    });
    
    res.on('end', () => {
      try {
        const response = JSON.parse(data);
        if (response.success) {
          TEST_ROOM_ID = response.roomId;
          console.log(`✅ Room created with ID: ${TEST_ROOM_ID}`);
          testResults.roomCreated = true;
          
          // Now create socket connections
          initializeSockets();
        } else {
          console.error('❌ Failed to create room:', response.error);
          printResults();
          process.exit(1);
        }
      } catch (error) {
        console.error('❌ Error parsing room creation response:', error);
        printResults();
        process.exit(1);
      }
    });
  });
  
  req.on('error', (error) => {
    console.error('❌ Error creating room:', error.message);
    printResults();
    process.exit(1);
  });
  
  req.write(postData);
  req.end();
}

// Function to initialize socket connections
function initializeSockets() {
  socket1 = io(SERVER_URL, {
    transports: ['websocket', 'polling'],
    forceNew: true
  });

  socket2 = io(SERVER_URL, {
    transports: ['websocket', 'polling'],
    forceNew: true
  });

  // Set up test timeout
  setTimeout(() => {
    console.log('\n⏰ Test timeout reached!');
    printResults();
    process.exit(0);
  }, 15000);

  // Socket 1 event handlers
  socket1.on('connect', () => {
    console.log('✅ Socket 1 connected');
    testResults.connection = true;
    
    // Join the created room
    socket1.emit('join-room', { roomId: TEST_ROOM_ID, username: USER1_NAME });
  });

  socket1.on('joined-room', () => {
    console.log('✅ Socket 1 joined room');
    testResults.roomJoin = true;
    
    // Have socket 2 join the room
    socket2.emit('join-room', { roomId: TEST_ROOM_ID, username: USER2_NAME });
  });
  
  socket1.on('user-typing', (data) => {
    if (data.username === USER2_NAME) {
      console.log('✅ Socket 1 received typing indicator from', data.username);
      testResults.typingReceived = true;
    }
  });
  
  socket1.on('user-stopped-typing', (data) => {
    if (data.username === USER2_NAME) {
      console.log('✅ Socket 1 received stop-typing indicator from', data.username);
      testResults.stopTypingReceived = true;
      
      // All tests completed
      setTimeout(() => {
        console.log('\n🎉 All typing indicator tests completed!');
        printResults();
        process.exit(0);
      }, 1000);
    }
  });
  
  socket1.on('connect_error', (error) => {
    console.error('❌ Socket 1 connection error:', error.message);
  });
  
  // Socket 2 event handlers
  socket2.on('connect', () => {
    console.log('✅ Socket 2 connected');
  });
  
  socket2.on('joined-room', () => {
    console.log('✅ Socket 2 joined room');
    
    // Start the typing test sequence
    setTimeout(() => {
      console.log('📝 Socket 2 starts typing...');
      socket2.emit('typing', { roomId: TEST_ROOM_ID, username: USER2_NAME });
      
      // Stop typing after 2 seconds
      setTimeout(() => {
        console.log('⏹️  Socket 2 stops typing...');
        socket2.emit('stop-typing', { roomId: TEST_ROOM_ID, username: USER2_NAME });
      }, 2000);
    }, 1000);
  });
  
  socket2.on('connect_error', (error) => {
    console.error('❌ Socket 2 connection error:', error.message);
  });
}

function printResults() {
  console.log('\n📊 Test Results:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🏠 Room Creation: ${testResults.roomCreated ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`🔌 Socket Connection: ${testResults.connection ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`🚪 Room Join: ${testResults.roomJoin ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`📝 Typing Indicator: ${testResults.typingReceived ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`⏹️  Stop Typing Indicator: ${testResults.stopTypingReceived ? '✅ PASS' : '❌ FAIL'}`);
  
  const allPassed = Object.values(testResults).every(result => result);
  console.log(`\n🎯 Overall Result: ${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
  
  if (!allPassed) {
    console.log('\n💡 Troubleshooting Tips:');
    if (!testResults.roomCreated) {
      console.log('   • Check if server is running');
      console.log('   • Verify server URL is correct');
      console.log('   • Check /api/create-room endpoint');
    }
    if (testResults.roomCreated && !testResults.connection) {
      console.log('   • Check WebSocket connection settings');
      console.log('   • Verify CORS configuration');
      console.log('   • Check firewall/network settings');
    }
    if (testResults.connection && !testResults.roomJoin) {
      console.log('   • Check join-room socket event handler on server');
      console.log('   • Verify room validation logic');
    }
    if (testResults.roomJoin && (!testResults.typingReceived || !testResults.stopTypingReceived)) {
      console.log('   • Check typing indicator socket events on server');
      console.log('   • Verify typing/stop-typing event broadcasting');
    }
  }
  
  if (socket1) socket1.disconnect();
  if (socket2) socket2.disconnect();
}

console.log('🚀 Starting typing indicator tests...');
createRoom(); 