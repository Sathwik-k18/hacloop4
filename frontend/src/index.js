import React, { useEffect, useState } from 'react';
import io from 'socket.io-client';
import './App.css'; 

// 🎯 This is the critical line! We assume your environment variable is named REACT_APP_API_URL
// If your frontend uses a different name, use that name instead.
const VERCEL_BACKEND_URL = process.env.REACT_APP_API_URL; 

// Initialize the socket connection
const socket = io(VERCEL_BACKEND_URL); 

function App() {
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // 1. Connection Handlers
    socket.on('connect', () => {
      setIsConnected(true);
      console.log("Connected to Vercel Backend!");
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
      console.log("Disconnected from Vercel Backend.");
    });
    
    // 2. Add your custom event listeners here
    socket.on('receive_message', (data) => {
      console.log("Message from server:", data);
      // Handle the received message in your UI
    });

    // Clean up the connection when the component unmounts
    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('receive_message');
    };
  }, []);

  return (
    <div className="App">
      <h1>Socket.IO Status: {isConnected ? 'Connected' : 'Disconnected'}</h1>
      {/* Your rest of the application UI goes here */}
    </div>
  );
}

export default App;