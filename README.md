# Connect PWA - Local Mesh Network Chat Application 🚀

Connect is a high-performance, offline-first Progressive Web App (PWA) designed for local mesh networking. It allows users on the same WiFi/Hotspot to communicate instantly via WebSockets and WebRTC without needing an internet connection.

## 🌟 Features

*   **Real-time Text Chat:** Instant messaging with typing indicators, read receipts, and offline message queuing.
*   **Voice Calling:** Native WebRTC peer-to-peer audio calls with custom UI and duration tracking.
*   **Voice Messages:** Press-and-hold to record and send voice memos directly in the chat.
*   **File Sharing:** Share images, documents, and other files (up to 10MB) directly over the local network via chunked WebSocket transfer.
*   **GPS Location Sharing:** Real-time location tracking rendered on a custom Canvas-based interactive map.
*   **Offline-First:** All messages and files are persisted locally using IndexedDB. The app can be installed to the home screen (PWA).
*   **Theme Engine:** Fully customizable Dark, Light, and Auto themes with dynamic accent colors.
*   **Zero-Config Discovery:** Automatically generates a QR code on the host server for instantaneous client joining.

## 📁 Project Structure

```text
connect/
├── client/                 # PWA Frontend
│   ├── css/                # Modular styling system
│   ├── js/                 # Application logic (chat, webrtc, gps, audio, etc)
│   ├── assets/             # Icons and static assets
│   ├── index.html          # Main application shell
│   ├── manifest.json       # PWA Manifest
│   ├── service-worker.js   # Offline caching & background notifications
│   └── install.js          # PWA installation prompt logic
├── server/                 # Node.js Backend
│   ├── data/               # Persistent server state (rooms.json)
│   ├── package.json        # Server dependencies
│   ├── server.js           # WebSocket and static HTTP server
│   ├── start.sh            # Linux/macOS startup script
│   └── start.bat           # Windows startup script
└── README.md
```

## 🚀 How to Run (Host Machine)

1.  Navigate to the `server/` directory.
2.  Install dependencies: `npm install`
3.  Start the server:
    *   **Windows:** Double-click `start.bat`
    *   **Linux/macOS:** Run `./start.sh`
4.  The server will start on port `3000` and display a large QR Code in the terminal.

## 📱 How to Connect (Client Devices)

**Requirement:** All devices must be a connected to the same Local Area Network (WiFi router or Mobile Hotspot).

**Option A: QR Code (Fastest)**
1.  Open your smartphone's camera.
2.  Scan the QR code displayed in the host machine's terminal.
3.  Tap the link to open the Connect app in your browser.

**Option B: Manual IP Entry**
1.  On the host machine's terminal, look for the "Network IP" (e.g., `http://192.168.1.5:3000`).
2.  Open a browser on any other device on the network.
3.  Type that exact URL into the address bar.

## 🔧 PWA Installation

Once the app is open in your browser, you can install it as a native app in :
*   **Android (Chrome):** Tap the 3-dot menu > "Install App" or "Add to Home screen".
*   **iOS (Safari):** Tap the Share button (square with an up arrow) > "Add to Home Screen".

## 🛡️ Privacy & Security

*   Data remains entirely on your local network.
*   There are no external database dependencies.
*   The application functions completely without an active internet connection (requires LAN only).
