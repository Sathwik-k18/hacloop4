// --- Imports ---
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

// --- Initialization ---
const app = express();
const server = http.createServer(app);

// --- Global State ---
// Stores room and participant data: Map<roomId, Map<socketId, participantData>>
const rooms = new Map();

// --- Utility Functions ---

/** Finds the roomId a socket is currently stored in */
const getRoomIdBySocketId = (socketId) => {
    for (const [roomId, roomMap] of rooms.entries()) {
        if (roomMap.has(socketId)) {
            return roomId;
        }
    }
    return null;
};

/** Handles removing a user from a room and cleaning up the room if empty */
function handleUserLeave(socket, roomId) {
    const room = rooms.get(roomId);
    if (room) {
        const user = room.get(socket.id);
        room.delete(socket.id);
        
        if (user) {
            console.log(`[ROOM UPDATE] ${user.name || socket.id} left room ${roomId}.`);
            // Notify others in the room
            socket.to(roomId).emit('user-left', { id: socket.id, name: user.name });
        }
        
        if (room.size === 0) {
            rooms.delete(roomId);
            console.log(`[ROOM CLEANUP] Room ${roomId} deleted (empty).`);
        } else {
            console.log(`[ROOM STATUS] Room ${roomId} now has ${room.size} participant(s).`);
        }
    }
    socket.leave(roomId);
}


// --- Middleware Setup ---
app.use(cors()); // Enables CORS for Express routes
app.use(express.json()); // Parses incoming JSON data

// --- Express Route (Health Check) ---
app.get('/', (req, res) => {
    res.send({
        activeStatus: true,
        error: false,
        message: "Video call server is running." 
    });
});


// --- Socket.IO Configuration ---
const io = new Server(server, {
    cors: {
        // IMPORTANT: Replace "*" with your specific frontend domain in production
        origin: "*", 
        methods: ["GET", "POST"]
    }
});


// --- Socket.IO Event Handling ---
io.on('connection', (socket) => {
    console.log(`[CONNECT] User connected: ${socket.id}`);

    // JOIN ROOM
    socket.on('join-room', ({ roomId, userName }) => {
        console.log(`[JOIN] ${userName} (${socket.id}) joining room: ${roomId}`);
        socket.join(roomId);
        
        // Create room map if it doesn't exist
        if (!rooms.has(roomId)) {
            rooms.set(roomId, new Map());
            console.log(`[ROOM CREATED] Room ${roomId} initialized.`);
        }
        
        const room = rooms.get(roomId);
        const newParticipant = {
            id: socket.id,
            name: userName,
            isCameraOn: true,
            isMicOn: true
        };
        room.set(socket.id, newParticipant);

        // 1. Send existing participants to the new user
        const existingParticipants = Array.from(room.values()).filter(p => p.id !== socket.id);
        socket.emit('existing-participants', existingParticipants);

        // 2. Notify others about the new participant
        socket.to(roomId).emit('user-joined', newParticipant);

        console.log(`[ROOM STATUS] Room ${roomId} now has ${room.size} participant(s).`);
    });

    // WEBRTC SIGNALING
    socket.on('offer', ({ to, offer, from }) => {
        // console.log(`[SIGNAL] Offer from ${from} -> ${to}`);
        io.to(to).emit('offer', { from, offer });
    });

    socket.on('answer', ({ to, answer, from }) => {
        // console.log(`[SIGNAL] Answer from ${from} -> ${to}`);
        io.to(to).emit('answer', { from, answer });
    });

    socket.on('ice-candidate', ({ to, candidate, from }) => {
        if (candidate) {
            io.to(to).emit('ice-candidate', { from, candidate });
        }
    });

    // CHAT MESSAGES
    socket.on('send-message', ({ roomId, message }) => {
        console.log(`[CHAT] Message in ${roomId}:`, message);
        io.to(roomId).emit('receive-message', { ...message, senderId: socket.id });
    });

    // TOGGLE CONTROLS
    socket.on('toggle-camera', ({ roomId, isCameraOn }) => {
        const room = rooms.get(roomId);
        if (room?.has(socket.id)) {
            room.get(socket.id).isCameraOn = isCameraOn;
            socket.to(roomId).emit('user-toggle-camera', { id: socket.id, isCameraOn });
        }
    });

    socket.on('toggle-mic', ({ roomId, isMicOn }) => {
        const room = rooms.get(roomId);
        if (room?.has(socket.id)) {
            room.get(socket.id).isMicOn = isMicOn;
            socket.to(roomId).emit('user-toggle-mic', { id: socket.id, isMicOn });
        }
    });

    // LEAVE ROOM (intentional client action)
    socket.on('leave-room', (roomId) => {
        console.log(`[LEAVE] ${socket.id} intentionally leaving room ${roomId}`);
        handleUserLeave(socket, roomId);
    });

    // DISCONNECT (user closes browser/loses connection)
    socket.on('disconnect', () => {
        console.log(`[DISCONNECT] User disconnected: ${socket.id}`);
        const currentRoomId = getRoomIdBySocketId(socket.id); 
        if (currentRoomId) {
            handleUserLeave(socket, currentRoomId);
        }
    });
});

// --- Server Listener (Dynamic Port) ---
// Uses the port provided by the hosting environment (Vercel) or defaults to 5000
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`[SERVER] Running on port ${PORT}`);
});