const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(__dirname));

// ── Constants ──────────────────────────────────────────
const PLAYER_COLORS  = ['#4ecca3', '#e94560', '#f5a623', '#a78bfa'];
const BOARD_SIZES    = {
  small:  { cols: 20, rows: 20 },
  medium: { cols: 30, rows: 30 },
  large:  { cols: 40, rows: 40 }
};
const DIFF_SPEEDS    = { easy: 220, medium: 180, hard: 120, insane: 70 };
const NUM_FOODS      = 5;
const AMMO_START     = 3;
const SHOOT_COOLDOWN = 1500; // ms
const MIN_LENGTH     = 5;
const SHOOT_COST     = 1;
const BULLET_SPEED   = 2;   // tiles per game tick

function getSpeed(diff) { return DIFF_SPEEDS[diff] || 180; }

// ── Room management ────────────────────────────────────
const rooms = new Map();

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

// ── Helpers ────────────────────────────────────────────
function placeFood(exclude, obstacles, foods, cols, rows) {
  let pos, tries = 0;
  do {
    pos = { x: Math.floor(Math.random() * cols), y: Math.floor(Math.random() * rows) };
    tries++;
  } while (tries < 500 && (
    exclude.some(e => e && e.x === pos.x && e.y === pos.y) ||
    obstacles.some(o => o.x === pos.x && o.y === pos.y) ||
    foods.some(f => f && f.x === pos.x && f.y === pos.y)
  ));
  return pos;
}

function fillFoods(room) {
  const allBodies = room.snakes.filter(s => s && s.alive).flatMap(s => s.body);
  while (room.foods.length < NUM_FOODS) {
    room.foods.push(placeFood(allBodies, room.obstacles, room.foods, room.settings.cols, room.settings.rows));
  }
}

function moveHead(head, d, wallsOn, cols, rows) {
  let nx = head.x + d.x, ny = head.y + d.y;
  if (!wallsOn) { nx = (nx + cols) % cols; ny = (ny + rows) % rows; }
  return { x: nx, y: ny };
}

function isWallDead(h, wallsOn, cols, rows) {
  return wallsOn && (h.x < 0 || h.x >= cols || h.y < 0 || h.y >= rows);
}

function getStartPositions(n, cols, rows) {
  const c = Math.floor(cols / 2), r = Math.floor(rows / 2);
  const q1x = Math.floor(cols * 0.25), q3x = Math.floor(cols * 0.75);
  const q1y = Math.floor(rows * 0.25), q3y = Math.floor(rows * 0.75);
  return [
    { body: [{ x: q1x, y: r   }, { x: q1x-1, y: r   }, { x: q1x-2, y: r   }], dir: { x:  1, y:  0 } },
    { body: [{ x: q3x, y: r   }, { x: q3x+1, y: r   }, { x: q3x+2, y: r   }], dir: { x: -1, y:  0 } },
    { body: [{ x: c,   y: q1y }, { x: c,     y: q1y-1}, { x: c,     y: q1y-2}], dir: { x:  0, y:  1 } },
    { body: [{ x: c,   y: q3y }, { x: c,     y: q3y+1}, { x: c,     y: q3y+2}], dir: { x:  0, y: -1 } },
  ].slice(0, n);
}

function spawnObstacles(room) {
  const { cols, rows, obstOn } = room.settings;
  if (!obstOn) return;
  const n = room.settings.maxPlayers * 3;
  const cx = Math.floor(cols / 2), cy = Math.floor(rows / 2);
  const safe = Math.floor(Math.min(cols, rows) * 0.15);
  const allBodies = room.snakes.filter(s => s).flatMap(s => s.body);
  for (let i = 0; i < n; i++) {
    let pos, tries = 0;
    do {
      pos = { x: Math.floor(Math.random() * cols), y: Math.floor(Math.random() * rows) };
      tries++;
    } while (tries < 100 && (
      allBodies.some(b => b.x === pos.x && b.y === pos.y) ||
      room.obstacles.some(o => o.x === pos.x && o.y === pos.y) ||
      (Math.abs(pos.x - cx) < safe && Math.abs(pos.y - cy) < safe)
    ));
    if (tries < 100) room.obstacles.push(pos);
  }
}

// ── Bullet stepping ────────────────────────────────────
function stepBullets(room) {
  const { wallsOn, bounceOn, cols, rows } = room.settings;
  const toRemove = new Set();
  const hits = {};

  room.bullets.forEach((b, bi) => {
    b.trail = b.trail || [];
    b.trail.push({ x: b.x, y: b.y });
    if (b.trail.length > 4) b.trail.shift();

    for (let step = 0; step < BULLET_SPEED; step++) {
      let nx = b.x + b.dx, ny = b.y + b.dy;

      if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) {
        if (bounceOn) {
          if (nx < 0 || nx >= cols) b.dx = -b.dx;
          if (ny < 0 || ny >= rows) b.dy = -b.dy;
          nx = b.x + b.dx; ny = b.y + b.dy;
          if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) { toRemove.add(bi); break; }
        } else { toRemove.add(bi); break; }
      }

      if (room.obstacles.some(o => o.x === nx && o.y === ny)) { toRemove.add(bi); break; }

      b.x = nx; b.y = ny;

      room.snakes.forEach((s, si) => {
        if (!s || !s.alive) return;
        s.body.forEach((seg, segIdx) => {
          if (b.x === seg.x && b.y === seg.y) {
            if (si === b.owner - 1 && segIdx === 0) return; // skip own head
            if (hits[si] === undefined || segIdx < hits[si]) hits[si] = segIdx;
            toRemove.add(bi);
          }
        });
      });
    }
  });

  const killedByBullet = new Set();
  Object.entries(hits).forEach(([si, chopIdx]) => {
    const idx = parseInt(si);
    const s = room.snakes[idx];
    if (!s || !s.alive) return;
    if (chopIdx === 0) {
      s.alive = false;
      room.obstacles.push(...s.body);
      killedByBullet.add(idx + 1);
    } else {
      s.body.splice(chopIdx);
    }
  });

  room.bullets = room.bullets.filter((_, i) => !toRemove.has(i));
  return killedByBullet;
}

// ── Start game ─────────────────────────────────────────
function startGame(room) {
  if (room.interval) clearInterval(room.interval);
  const { cols, rows, diff } = room.settings;
  const starts   = getStartPositions(room.settings.maxPlayers, cols, rows);
  const prevWins = room.snakes?.map(s => s ? s.wins : 0) || [];

  let si = 0;
  room.snakes = room.players.map((ws, i) => {
    if (!ws) return null;
    const sp = starts[si++];
    return {
      id:    i + 1,
      body:  sp.body.map(p => ({ ...p })),
      dir:   { ...sp.dir },
      nd:    { ...sp.dir },
      alive: true,
      wins:  prevWins[i] || 0,
      color: PLAYER_COLORS[i],
      ammo:  AMMO_START,
      lastShot: 0
    };
  });

  room.obstacles    = [];
  room.bullets      = [];
  room.foods        = [];
  room.restartVotes = new Set();

  spawnObstacles(room);
  fillFoods(room);

  room.running = true;
  broadcastState(room);
  room.interval = setInterval(() => stepGame(room), getSpeed(diff));
}

// ── Game step ──────────────────────────────────────────
function stepGame(room) {
  if (!room.running) return;
  const { wallsOn, cols, rows } = room.settings;
  const alive = room.snakes.filter(s => s && s.alive);
  if (alive.length === 0) return;

  // Apply directions & compute heads
  alive.forEach(s => {
    s.dir    = { ...s.nd };
    s.newHead = moveHead(s.body[0], s.dir, wallsOn, cols, rows);
  });

  // Which food each snake eats
  alive.forEach(s => {
    s.ateIdx = room.foods.findIndex(f => f && s.newHead.x === f.x && s.newHead.y === f.y);
  });

  // Project next bodies for cross-snake collision
  alive.forEach(s => {
    s.nextBody = s.ateIdx >= 0
      ? [s.newHead, ...s.body]
      : [s.newHead, ...s.body.slice(0, -1)];
  });

  // Death detection
  const deathSet = new Set();
  alive.forEach(s => {
    const h = s.newHead;
    if (isWallDead(h, wallsOn, cols, rows))                         { deathSet.add(s.id); return; }
    if (room.obstacles.some(o => o.x === h.x && o.y === h.y))      { deathSet.add(s.id); return; }
    if (s.body.slice(0,-1).some(b => b.x === h.x && b.y === h.y))  { deathSet.add(s.id); return; }
    alive.forEach(other => {
      if (other.id === s.id) return;
      if (other.nextBody.slice(1).some(b => b.x === h.x && b.y === h.y)) deathSet.add(s.id);
    });
  });
  // Head-on
  for (let i = 0; i < alive.length; i++)
    for (let j = i + 1; j < alive.length; j++)
      if (alive[i].newHead.x === alive[j].newHead.x && alive[i].newHead.y === alive[j].newHead.y) {
        deathSet.add(alive[i].id); deathSet.add(alive[j].id);
      }

  // Kill collided snakes — bodies become obstacles
  alive.forEach(s => {
    if (deathSet.has(s.id)) { s.alive = false; room.obstacles.push(...s.body); }
  });

  // Move survivors & handle food
  const survivors  = alive.filter(s => !deathSet.has(s.id));
  const eatenIdxs  = new Set();
  survivors.forEach(s => {
    s.body.unshift(s.newHead);
    if (s.ateIdx >= 0 && !eatenIdxs.has(s.ateIdx)) {
      eatenIdxs.add(s.ateIdx);
      s.ammo++;
    } else {
      s.body.pop();
    }
  });

  eatenIdxs.forEach(idx => { room.foods[idx] = null; });
  room.foods = room.foods.filter(f => f !== null);
  fillFoods(room);

  // Step bullets
  const bulletKills = stepBullets(room);
  bulletKills.forEach(id => deathSet.add(id));

  // Win check
  const stillAlive = room.snakes.filter(s => s && s.alive);
  if (stillAlive.length <= 1) {
    room.running = false;
    clearInterval(room.interval);
    const winner = stillAlive.length === 1 ? stillAlive[0].id : 0;
    if (winner > 0) stillAlive[0].wins++;
    broadcast(room, {
      type:   'end',
      winner,
      wins:   room.snakes.map(s => s ? s.wins : 0),
      deaths: Array.from(deathSet)
    });
    return;
  }

  broadcastState(room);
}

// ── Broadcast ──────────────────────────────────────────
function broadcastState(room) {
  broadcast(room, {
    type:      'state',
    snakes:    room.snakes.map(s => s ? {
      id: s.id, body: s.body, dir: s.dir,
      alive: s.alive, color: s.color, ammo: s.ammo
    } : null),
    foods:     room.foods,
    obstacles: room.obstacles,
    bullets:   room.bullets.map(b => ({
      x: b.x, y: b.y, dx: b.dx, dy: b.dy,
      owner: b.owner, trail: b.trail
    }))
  });
}

function broadcast(room, msg) {
  const data = JSON.stringify(msg);
  room.players.forEach(ws => { if (ws && ws.readyState === WebSocket.OPEN) ws.send(data); });
}

function send(ws, msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

// ── WebSocket handler ──────────────────────────────────
wss.on('connection', (ws) => {
  let room = null;
  let playerIdx = null;

  function handlePlayerLeft() {
    if (!room) return;
    room.players[playerIdx] = null;
    if (room.snakes?.[playerIdx]?.alive) {
      room.snakes[playerIdx].alive = false;
      room.obstacles.push(...room.snakes[playerIdx].body);
    }
    const remaining = room.players.filter(p => p);
    if (remaining.length === 0) {
      if (room.interval) clearInterval(room.interval);
      rooms.delete(room.code);
    } else {
      broadcast(room, { type: 'player_left', player: playerIdx + 1 });
      if (room.running) {
        const stillAlive = room.snakes.filter(s => s && s.alive);
        if (stillAlive.length <= 1) {
          room.running = false;
          clearInterval(room.interval);
          const winner = stillAlive.length === 1 ? stillAlive[0].id : 0;
          if (winner > 0) stillAlive[0].wins++;
          broadcast(room, {
            type: 'end', winner,
            wins: room.snakes.map(s => s ? s.wins : 0),
            deaths: []
          });
        }
      }
    }
    room = null;
  }

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    switch (msg.type) {

      case 'create': {
        if (room) return;
        const code    = genCode();
        const boardSz = BOARD_SIZES[msg.boardSize] || BOARD_SIZES.small;
        const maxP    = Math.min(Math.max(parseInt(msg.maxPlayers) || 2, 2), 4);
        room = {
          code,
          players: new Array(maxP).fill(null),
          settings: {
            cols:      boardSz.cols,
            rows:      boardSz.rows,
            boardSize: msg.boardSize || 'small',
            wallsOn:   msg.wallsOn  !== false,
            obstOn:    !!msg.obstOn,
            bounceOn:  !!msg.bounceOn,
            diff:      msg.diff || 'medium',
            maxPlayers: maxP
          },
          snakes: [], foods: [], obstacles: [], bullets: [],
          running: false, restartVotes: new Set(), interval: null
        };
        room.players[0] = ws;
        rooms.set(code, room);
        playerIdx = 0;
        send(ws, { type: 'created', code, player: 1, settings: room.settings });
        break;
      }

      case 'join': {
        if (room) return;
        const code = (msg.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const r    = rooms.get(code);
        if (!r)         { send(ws, { type: 'error', msg: 'Room not found.' }); return; }
        const slot = r.players.indexOf(null);
        if (slot < 0)   { send(ws, { type: 'error', msg: 'Room is full.'   }); return; }
        r.players[slot] = ws;
        room = r; playerIdx = slot;
        const connected = r.players.filter(p => p).length;
        send(ws, { type: 'joined', code, player: slot + 1, settings: r.settings });
        r.players.forEach((p, i) => {
          if (p && i !== slot) send(p, { type: 'player_joined', connected, player: slot + 1 });
        });
        if (connected === r.settings.maxPlayers) {
          let count = 3;
          broadcast(r, { type: 'countdown', count });
          const cd = setInterval(() => {
            count--;
            if (count > 0) broadcast(r, { type: 'countdown', count });
            else { clearInterval(cd); startGame(r); }
          }, 1000);
        }
        break;
      }

      case 'start_game': {
        if (!room || playerIdx !== 0 || room.running) return;
        const connected = room.players.filter(p => p).length;
        if (connected < 2) { send(ws, { type: 'error', msg: 'Need at least 2 players.' }); return; }
        let count = 3;
        broadcast(room, { type: 'countdown', count });
        const cdg = setInterval(() => {
          count--;
          if (count > 0) broadcast(room, { type: 'countdown', count });
          else { clearInterval(cdg); startGame(room); }
        }, 1000);
        break;
      }

      case 'dir': {
        if (!room || !room.running || !msg.d) return;
        const snake = room.snakes[playerIdx];
        if (!snake || !snake.alive) return;
        const d = msg.d;
        if (!(d.x === -snake.dir.x && d.y === -snake.dir.y)) snake.nd = d;
        break;
      }

      case 'shoot': {
        if (!room || !room.running) return;
        const snake = room.snakes[playerIdx];
        if (!snake || !snake.alive) return;
        const now = Date.now();
        if (snake.ammo <= 0)                       return;
        if (now - snake.lastShot < SHOOT_COOLDOWN) return;
        if (snake.body.length <= MIN_LENGTH)       return;
        for (let i = 0; i < SHOOT_COST; i++) {
          if (snake.body.length > 3) snake.body.pop();
        }
        snake.ammo--;
        snake.lastShot = now;
        const head = snake.body[0];
        room.bullets.push({
          x:     head.x + snake.dir.x,
          y:     head.y + snake.dir.y,
          dx:    snake.dir.x,
          dy:    snake.dir.y,
          owner: snake.id,
          trail: [],
          age:   0
        });
        break;
      }

      case 'restart': {
        if (!room) return;
        room.restartVotes.add(playerIdx);
        const needed = room.players.filter(p => p).length;
        if (room.restartVotes.size >= needed) {
          room.restartVotes.clear();
          startGame(room);
        } else {
          broadcast(room, {
            type: 'restart_vote',
            from: playerIdx + 1,
            have: room.restartVotes.size,
            need: needed
          });
        }
        break;
      }

      case 'settings_update': {
        if (!room || playerIdx !== 0 || room.running) return;
        const boardSz = BOARD_SIZES[msg.boardSize] || BOARD_SIZES[room.settings.boardSize];
        room.settings = {
          ...room.settings,
          cols:      boardSz.cols,
          rows:      boardSz.rows,
          boardSize: msg.boardSize  || room.settings.boardSize,
          wallsOn:   msg.wallsOn  !== undefined ? msg.wallsOn  : room.settings.wallsOn,
          obstOn:    msg.obstOn   !== undefined ? msg.obstOn   : room.settings.obstOn,
          bounceOn:  msg.bounceOn !== undefined ? msg.bounceOn : room.settings.bounceOn,
          diff:      msg.diff     || room.settings.diff
        };
        broadcast(room, { type: 'settings_sync', settings: room.settings });
        break;
      }
    }
  });

  ws.on('close', handlePlayerLeft);
  ws.on('error', handlePlayerLeft);
});

server.listen(5000, '0.0.0.0', () => {
  console.log('🐍 Snake Shooter server running on port 5000');
});
