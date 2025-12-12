const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const helmet = require("helmet");
const cors = require("cors");
const sanitizeHtml = require("sanitize-html");

const app = express();
const server = http.createServer(app);

// --- 1. Security Configuration ---
// Helmet adds HTTP headers to protect against common attacks
app.use(helmet({
  contentSecurityPolicy: false // Disabled slightly for this simple demo structure
}));
app.use(cors()); // Allow cross-origin requests

// Serve the "public" folder (where we will put HTML/CSS/JS later)
app.use(express.static(path.join(__dirname, "public")));

// --- 2. Socket.IO Setup ---
// --- (With 5MB Limit) ---
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000,
  maxHttpBufferSize: 5 * 1024 * 1024 // Allow up to 5MB packets (for images)
});

const PORT = process.env.PORT || 5000;

// --- 3. State Management (Data Storage) ---
// We use Maps for O(1) performance (instant lookup)
const rooms = new Map();   // Stores Room Data
const sockets = new Map(); // Stores User Metadata (linked to socket ID)

// Configuration constants
const CONFIG = {
  MAX_MSG_LENGTH: 500,
  MAX_HISTORY: 50, // Keep last 50 messages per room
};

// --- 4. Helper Functions ---

// Creates a fresh room object
const createRoom = (name, password = null) => ({
  name,
  password, // Store the password (or null)
  users: new Map(), // Stores users in this specific room
  messages: [],     // Stores chat history
  createdAt: new Date().toISOString()
});

// Cleans text to prevent XSS (Script Injection)
const sanitize = (text) => sanitizeHtml(text, {
  allowedTags: [],       // Remove ALL HTML tags (only text allowed)
  allowedAttributes: {}
});

// Returns a list of rooms for the Lobby UI
const getRoomsSnapshot = () => {
  return Array.from(rooms.values()).map(r => ({
    name: r.name,
    userCount: r.users.size,
    id: r.name, // simple ID
    isLocked: !!r.password // Returns true if password exists, false if null
  }));
};

// --- 5. Event Listeners ( The Logic ) ---

io.on("connection", (socket) => {
  // Init user data
  sockets.set(socket.id, { username: null, roomName: null });

  // Send the list of rooms immediately upon connection
  socket.emit("rooms:list", getRoomsSnapshot());

  // EVENT: Create a Room
  socket.on("room:create", ({ roomName, password }, cb) => {
    const cleanName = sanitize(roomName || "").trim().substring(0, 20);
    
    if (!cleanName) return cb({ error: "Invalid room name" });
    if (rooms.has(cleanName)) return cb({ error: "Room already exists" });

    // Store room with password (if provided)
    rooms.set(cleanName, createRoom(cleanName, password || null));
    
    io.emit("rooms:list", getRoomsSnapshot());
    
    cb({ ok: true, roomName: cleanName });
  });

  // EVENT: Join a Room
  socket.on("room:join", ({ roomName, username, password }, cb) => {
    const room = rooms.get(roomName);
    if (!room) return cb({ error: "Room not found" });

    // --- SECURITY CHECK ---
    if (room.password) {
      if (room.password !== password) {
        return cb({ error: "Incorrect Password" });
      }
    }
    // ----------------------

    const cleanUser = sanitize(username || "").trim().substring(0, 15);
    if (!cleanUser) return cb({ error: "Invalid username" });

    // Check for duplicate username in THIS room
    if (room.users.has(cleanUser) && room.users.get(cleanUser) !== socket.id) {
      return cb({ error: "Username taken in this room" });
    }

    // Join logic
    socket.join(roomName);
    room.users.set(cleanUser, socket.id);
    
    // Update socket metadata
    sockets.set(socket.id, { username: cleanUser, roomName });

    // Notify others in the room
    socket.to(roomName).emit("room:user-joined", { 
      username: cleanUser, 
      userCount: room.users.size 
    });

    // Send success callback to client
    cb({ 
      ok: true, 
      history: room.messages, // Send chat history
      users: Array.from(room.users.keys()) // Send user list
    });

    // Update lobby counts globally
    io.emit("rooms:list", getRoomsSnapshot());
  });

  // EVENT: Chat Message
  socket.on("chat:message", ({ text, image }, cb) => {
    const meta = sockets.get(socket.id);
    if (!meta || !meta.roomName) return cb && cb({ error: "Not in a room" });

    // Allow if text exists OR image exists
    const cleanText = sanitize(text || "").substring(0, CONFIG.MAX_MSG_LENGTH);
    if (!cleanText && !image) return cb && cb({ error: "Empty message" });

    const message = {
      id: Date.now().toString(),
      username: meta.username,
      text: cleanText,
      image: image || null, // Pass image through
      time: new Date().toISOString()
    };

    const room = rooms.get(meta.roomName);
    if (room) {
      room.messages.push(message);
      if (room.messages.length > CONFIG.MAX_HISTORY) room.messages.shift();
    }

    io.to(meta.roomName).emit("chat:message", message);
    cb && cb({ ok: true });
  });

  // EVENT: Chat Typing
  socket.on("chat:typing", (isTyping) => {
    const meta = sockets.get(socket.id);
    if (meta.roomName) {
      socket.to(meta.roomName).emit("chat:typing", { 
        username: meta.username, 
        isTyping: !!isTyping 
      });
    }
  });

  // EVENT: Disconnect / Leave
  const handleLeave = () => {
    const meta = sockets.get(socket.id);
    if (!meta || !meta.roomName) return;

    const room = rooms.get(meta.roomName);
    if (room) {
      room.users.delete(meta.username);
      socket.leave(meta.roomName);
      
      // Notify room
      socket.to(meta.roomName).emit("room:user-left", { 
        username: meta.username 
      });

      // If room is empty, delete it to save memory
      if (room.users.size === 0) {
        rooms.delete(meta.roomName);
      }
      
      // Update global lobby
      io.emit("rooms:list", getRoomsSnapshot());
    }
    sockets.delete(socket.id);
  };

  socket.on("room:leave", handleLeave);
  socket.on("disconnect", handleLeave);
});

// Start Server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});