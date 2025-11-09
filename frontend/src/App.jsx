import React, { useEffect, useState } from 'react';
import io from 'socket.io-client';
import './App.css'; // Assuming you have an App.css

// 🎯 CRITICAL LINE: Define the environment variable name
// Netlify needs you to set the value for this key in its dashboard.
const VERCEL_BACKEND_URL = process.env.REACT_APP_API_URL; 

// Initialize the socket connection outside the component
const socket = io(VERCEL_BACKEND_URL); 

function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [messages, setMessages] = useState([]);
  
  useEffect(() => {
    // 1. Connection Handlers
    socket.on('connect', () => {
      setIsConnected(true);
      console.log("Socket Connected to Backend!");
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
      console.log("Socket Disconnected.");
    });
    
    // 2. Custom Event Listener (example)
    socket.on('receive_message', (data) => {
      console.log('New message received:', data);
      setMessages((prev) => [...prev, data]);
    });

    // Cleanup: Remove listeners when the component unmounts
    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('receive_message');
    };
  }, []);

  // Example function to send a message
  const sendMessage = () => {
    const messageData = { user: "Frontend", message: "Initial handshake complete!" };
    socket.emit('send_message', messageData);
  };

  return (
    <div className="App">
      <h1>Deployment Test Application</h1>
      <p>Backend Connection Status: **{isConnected ? 'LIVE' : 'Connecting...'}**</p>
      <button onClick={sendMessage} disabled={!isConnected}>Send Test Message to Server</button>
      
      <div>
        <h2>Received Messages:</h2>
        {messages.map((msg, index) => (
          <p key={index}>[{msg.user}]: {msg.message}</p>
        ))}
      </div>
    </div>
  );
}

export default App;