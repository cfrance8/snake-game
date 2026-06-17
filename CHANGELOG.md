# Changelog

All notable changes to Snake Shooter will be documented in this file.

---

## [0.3.3] — 2026-06-17

### 🔫 Shooting System
- Added bullet firing mechanic — press Space, F, or on-screen 🔫 button
- Bullets travel at 2 tiles per tick in the direction the snake is moving
- Body hit chops the snake from that segment onward
- Head hit is an instant kill
- Shooting costs 1 tail segment per shot
- 1.5 second cooldown between shots
- Minimum length of 5 segments required to shoot
- Start with 3 ammo, earn +1 per food eaten
- Bullets render with a glowing color-coded trail
- Added Bounce toggle — bullets ricochet off walls instead of disappearing

### 🍎 Food
- Increased food on the board from 2 to 5 pieces at all times
- Food is instantly replaced when eaten
- Each food piece has a unique color

### 🌐 Online Multiplayer
- Added Online mode with room creation and 4-character join codes
- Supports 2–4 players per room
- Server-authoritative game logic (no cheating)
- Shooting fully synced across all clients in real time
- Bullets broadcast to all players each tick with position and trail
- Settings sync from host to all players (board size, walls, obstacles, bounce, difficulty)
- Countdown timer before each game starts
- Rematch voting system — all players must vote to restart
- Win tracking across rematches
- Dead snakes become obstacles (battle royale style)
- Graceful handling of disconnects and players leaving mid-game

### 🗺️ Board Sizes
- Added Small (20×20), Medium (30×30), and Large (40×40) board options
- Canvas resizes dynamically based on selection
- Scales to fit screen on smaller devices

### 🎮 1v1 Local Mode
- Added local two-player mode on the same keyboard
- P1 uses WASD + F to shoot
- P2 uses Arrow keys + / to shoot
- Dual on-screen d-pads for mobile play
- Win counter tracks rounds

### 📱 Mobile
- Swipe to move in 1P and online mode
- Double-tap canvas to shoot in 1P and online mode

### 🛠️ Technical
- Added `server.js` — Node.js + WebSocket backend
- Added `package.json` with Express and ws dependencies
- Server runs on port 5000 and serves static files
- Favicon 404 suppressed with a no-content response

---

## [0.1.0] — Initial Release

- 1 Player snake game
- Difficulty selector (Easy, Medium, Hard, Insane)
- Walls, Obstacles, and Sound toggles
- Score, best score, and level tracking
- Mobile swipe support
- On-screen d-pad controls
