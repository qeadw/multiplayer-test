// Game constants
const TILE_SIZE = 64;
const TILES_PER_CHUNK = 8;
const CHUNK_SIZE = TILE_SIZE * TILES_PER_CHUNK;
const WORLD_SIZE = 3;
const WORLD_PIXELS = CHUNK_SIZE * WORLD_SIZE;
const PLAYER_SPEED = 150;
const UPDATE_RATE = 50;
const ATTACK_RANGE = 60;
const ATTACK_COOLDOWN = 500;
const MAX_HEALTH = 4;
const SPAWN_X = WORLD_PIXELS / 2;
const SPAWN_Y = WORLD_PIXELS / 2;

// Isometric constants
const ISO_TILE_WIDTH = 64;
const ISO_TILE_HEIGHT = 32;

// Player ID (assigned by server)
let playerId = null;

// Generate a random color for this player
const playerHue = Math.random() * 360;
const playerColor = `hsl(${playerHue}, 70%, 50%)`;
const playerColorDark = `hsl(${playerHue}, 70%, 35%)`;
const playerColorLight = `hsl(${playerHue}, 70%, 65%)`;

// Canvas setup
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const playerCountEl = document.getElementById('player-count');

// Pre-rendered world canvas (for performance)
let worldCanvas = null;
let worldCtx = null;
let worldRendered = false;

// Audio context for sounds
let audioCtx = null;
function playDeathSound() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.setValueAtTime(400, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.3);
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.3);
}

function playHitSound() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = 'square';
    osc.frequency.setValueAtTime(200, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.1);
}

// Game state
let player = {
    x: SPAWN_X,
    y: SPAWN_Y,
    color: playerColor,
    colorDark: playerColorDark,
    colorLight: playerColorLight,
    hue: playerHue,
    facingRight: true,
    health: MAX_HEALTH
};

let otherPlayers = {};
let lastUpdateTime = 0;
let lastAttackTime = 0;
let ws = null;
let connected = false;

// Input state
const input = { up: false, down: false, left: false, right: false };

// Resize canvas
function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Input handling
window.addEventListener('keydown', (e) => {
    switch (e.key.toLowerCase()) {
        case 'w': case 'arrowup': input.up = true; break;
        case 's': case 'arrowdown': input.down = true; break;
        case 'a': case 'arrowleft': input.left = true; break;
        case 'd': case 'arrowright': input.right = true; break;
        case ' ': tryAttack(); e.preventDefault(); break;
    }
});

window.addEventListener('keyup', (e) => {
    switch (e.key.toLowerCase()) {
        case 'w': case 'arrowup': input.up = false; break;
        case 's': case 'arrowdown': input.down = false; break;
        case 'a': case 'arrowleft': input.left = false; break;
        case 'd': case 'arrowright': input.right = false; break;
    }
});

canvas.addEventListener('click', () => tryAttack());

// Convert world coordinates to isometric screen coordinates
function worldToIso(x, y) {
    return {
        x: (x - y) * (ISO_TILE_WIDTH / TILE_SIZE / 2),
        y: (x + y) * (ISO_TILE_HEIGHT / TILE_SIZE / 2)
    };
}

// Wrap position (Pac-Man style)
function wrapPosition(pos) {
    if (pos < 0) return pos + WORLD_PIXELS;
    if (pos >= WORLD_PIXELS) return pos - WORLD_PIXELS;
    return pos;
}

// Get distance between two points
function getDistance(x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
}

// Find nearest player in attack range
function findNearestPlayer() {
    let nearest = null, nearestDist = ATTACK_RANGE;
    for (const [id, p] of Object.entries(otherPlayers)) {
        const dist = getDistance(player.x, player.y, p.x, p.y);
        if (dist < nearestDist) { nearestDist = dist; nearest = id; }
    }
    return nearest;
}

// Try to attack
function tryAttack() {
    const now = Date.now();
    if (now - lastAttackTime < ATTACK_COOLDOWN) return;
    const targetId = findNearestPlayer();
    if (!targetId) return;
    lastAttackTime = now;
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "attack", targetId }));
    }
}

// Update player position
function updatePlayer(deltaTime) {
    let vx = 0, vy = 0;
    if (input.up) { vx -= 1; vy -= 1; }
    if (input.down) { vx += 1; vy += 1; }
    if (input.left) { vx -= 1; vy += 1; }
    if (input.right) { vx += 1; vy -= 1; }

    if (vx !== 0 || vy !== 0) {
        const len = Math.sqrt(vx * vx + vy * vy);
        vx /= len; vy /= len;
    }

    player.x = wrapPosition(player.x + vx * PLAYER_SPEED * deltaTime);
    player.y = wrapPosition(player.y + vy * PLAYER_SPEED * deltaTime);
    if (vx > 0) player.facingRight = true;
    if (vx < 0) player.facingRight = false;
}

// Send position to server
function sendPosition() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    if (now - lastUpdateTime < UPDATE_RATE) return;
    lastUpdateTime = now;
    ws.send(JSON.stringify({
        type: "update", x: player.x, y: player.y, hue: player.hue, facingRight: player.facingRight
    }));
}

// Connect to server
function connectToServer() {
    const wsUrl = 'wss://multiplayer-test.averyopela1.workers.dev/ws?room=default';
    playerCountEl.textContent = 'Connecting...';
    ws = new WebSocket(wsUrl);

    ws.onopen = () => { connected = true; sendPosition(); };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            switch (data.type) {
                case 'init':
                    playerId = data.yourId;
                    player.health = MAX_HEALTH;
                    for (const [id, pData] of Object.entries(data.players)) {
                        if (id !== playerId) {
                            otherPlayers[id] = {
                                ...pData,
                                color: `hsl(${pData.hue}, 70%, 50%)`,
                                colorDark: `hsl(${pData.hue}, 70%, 35%)`,
                                colorLight: `hsl(${pData.hue}, 70%, 65%)`,
                                health: pData.health || MAX_HEALTH
                            };
                        }
                    }
                    updatePlayerCount();
                    break;
                case 'player_update':
                    if (data.id !== playerId) {
                        const isNew = !otherPlayers[data.id];
                        otherPlayers[data.id] = {
                            x: data.x, y: data.y, hue: data.hue, facingRight: data.facingRight,
                            color: `hsl(${data.hue}, 70%, 50%)`,
                            colorDark: `hsl(${data.hue}, 70%, 35%)`,
                            colorLight: `hsl(${data.hue}, 70%, 65%)`,
                            health: data.health || MAX_HEALTH
                        };
                        if (isNew) updatePlayerCount();
                    }
                    break;
                case 'player_joined':
                    updatePlayerCount();
                    break;
                case 'player_left':
                    delete otherPlayers[data.id];
                    updatePlayerCount();
                    break;
                case 'hit':
                    if (data.targetId === playerId) {
                        player.health = data.newHealth;
                        playHitSound();
                        if (player.health <= 0) {
                            playDeathSound();
                            player.x = SPAWN_X; player.y = SPAWN_Y; player.health = MAX_HEALTH;
                        }
                    }
                    if (otherPlayers[data.targetId]) {
                        otherPlayers[data.targetId].health = data.newHealth;
                        if (data.newHealth <= 0) playDeathSound();
                    }
                    break;
                case 'respawn':
                    if (data.id === playerId) {
                        player.x = data.x; player.y = data.y; player.health = MAX_HEALTH;
                    } else if (otherPlayers[data.id]) {
                        otherPlayers[data.id].x = data.x;
                        otherPlayers[data.id].y = data.y;
                        otherPlayers[data.id].health = MAX_HEALTH;
                    }
                    break;
            }
        } catch (e) { console.error('Parse error:', e); }
    };

    ws.onclose = () => {
        connected = false;
        playerCountEl.textContent = 'Reconnecting...';
        setTimeout(connectToServer, 2000);
    };
    ws.onerror = () => {};
}

function updatePlayerCount() {
    playerCountEl.textContent = `Players: ${Object.keys(otherPlayers).length + 1}`;
}

// Pre-render the world to an offscreen canvas (HUGE performance boost)
function prerenderWorld() {
    const tilesX = TILES_PER_CHUNK * WORLD_SIZE;
    const tilesY = TILES_PER_CHUNK * WORLD_SIZE;

    // Calculate isometric bounds
    const topLeft = worldToIso(0, 0);
    const topRight = worldToIso(WORLD_PIXELS, 0);
    const bottomLeft = worldToIso(0, WORLD_PIXELS);
    const bottomRight = worldToIso(WORLD_PIXELS, WORLD_PIXELS);

    const minX = Math.min(topLeft.x, bottomLeft.x);
    const maxX = Math.max(topRight.x, bottomRight.x);
    const minY = Math.min(topLeft.y, topRight.y);
    const maxY = Math.max(bottomLeft.y, bottomRight.y);

    const width = Math.ceil(maxX - minX) + ISO_TILE_WIDTH;
    const height = Math.ceil(maxY - minY) + ISO_TILE_HEIGHT;

    worldCanvas = document.createElement('canvas');
    worldCanvas.width = width;
    worldCanvas.height = height;
    worldCtx = worldCanvas.getContext('2d');

    const offsetX = -minX + ISO_TILE_WIDTH / 2;
    const offsetY = -minY + ISO_TILE_HEIGHT / 2;

    // Draw all tiles once
    for (let tx = 0; tx < tilesX; tx++) {
        for (let ty = 0; ty < tilesY; ty++) {
            const tileWorldX = tx * TILE_SIZE + TILE_SIZE / 2;
            const tileWorldY = ty * TILE_SIZE + TILE_SIZE / 2;
            const iso = worldToIso(tileWorldX, tileWorldY);
            const screenX = iso.x + offsetX;
            const screenY = iso.y + offsetY;

            const chunkX = Math.floor(tx / TILES_PER_CHUNK);
            const chunkY = Math.floor(ty / TILES_PER_CHUNK);
            const isEvenChunk = (chunkX + chunkY) % 2 === 0;
            const isEvenTile = (tx + ty) % 2 === 0;

            let color1, color2, stroke;
            if (isEvenChunk) {
                color1 = isEvenTile ? '#1e3a5f' : '#1a3152';
                color2 = isEvenTile ? '#162d4d' : '#142640';
                stroke = '#2d5a8a';
            } else {
                color1 = isEvenTile ? '#2d1e5f' : '#261a52';
                color2 = isEvenTile ? '#221645' : '#1c1238';
                stroke = '#4a2d8a';
            }

            drawIsoTile(worldCtx, screenX, screenY, color1, color2, stroke);
        }
    }

    worldRendered = true;

    // Store offset for drawing
    worldCanvas.offsetX = offsetX;
    worldCanvas.offsetY = offsetY;
}

// Draw an isometric tile
function drawIsoTile(context, screenX, screenY, color1, color2, strokeColor) {
    const hw = ISO_TILE_WIDTH / 2;
    const hh = ISO_TILE_HEIGHT / 2;

    context.beginPath();
    context.moveTo(screenX, screenY - hh);
    context.lineTo(screenX + hw, screenY);
    context.lineTo(screenX, screenY + hh);
    context.lineTo(screenX - hw, screenY);
    context.closePath();

    // Simple fill instead of gradient for performance
    context.fillStyle = color1;
    context.fill();
    context.strokeStyle = strokeColor;
    context.lineWidth = 1;
    context.stroke();
}

// Draw the world using pre-rendered canvas
function drawWorld(cameraIsoX, cameraIsoY) {
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!worldRendered) prerenderWorld();

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const drawX = centerX - cameraIsoX - worldCanvas.offsetX;
    const drawY = centerY - cameraIsoY - worldCanvas.offsetY;

    ctx.drawImage(worldCanvas, drawX, drawY);
}

// Draw health bar
function drawHealthBar(screenX, screenY, health, isLocal) {
    const barWidth = 30, barHeight = 4, y = screenY - 45;
    ctx.fillStyle = '#333';
    ctx.fillRect(screenX - barWidth / 2, y, barWidth, barHeight);
    ctx.fillStyle = health > 2 ? '#4ade80' : health > 1 ? '#fbbf24' : '#ef4444';
    ctx.fillRect(screenX - barWidth / 2, y, (health / MAX_HEALTH) * barWidth, barHeight);
    ctx.strokeStyle = isLocal ? '#fff' : '#888';
    ctx.lineWidth = 1;
    ctx.strokeRect(screenX - barWidth / 2, y, barWidth, barHeight);
}

// Draw an isometric player
function drawIsoPlayer(worldX, worldY, colors, isLocal, health, cameraIsoX, cameraIsoY) {
    const centerX = canvas.width / 2, centerY = canvas.height / 2;
    const iso = worldToIso(worldX, worldY);
    const screenX = centerX + iso.x - cameraIsoX;
    const screenY = centerY + iso.y - cameraIsoY;

    if (screenX < -50 || screenX > canvas.width + 50 || screenY < -50 || screenY > canvas.height + 50) return;

    const size = 20, height = 30;

    // Shadow
    ctx.beginPath();
    ctx.ellipse(screenX, screenY + 5, size / 2, size / 4, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fill();

    // Cube faces
    ctx.fillStyle = colors.colorLight;
    ctx.strokeStyle = isLocal ? '#fff' : 'rgba(255,255,255,0.3)';
    ctx.lineWidth = isLocal ? 2 : 1;

    // Top
    ctx.beginPath();
    ctx.moveTo(screenX, screenY - height);
    ctx.lineTo(screenX + size/2, screenY - height + size/4);
    ctx.lineTo(screenX, screenY - height + size/2);
    ctx.lineTo(screenX - size/2, screenY - height + size/4);
    ctx.closePath();
    ctx.fill(); ctx.stroke();

    // Left
    ctx.fillStyle = colors.colorDark;
    ctx.beginPath();
    ctx.moveTo(screenX - size/2, screenY - height + size/4);
    ctx.lineTo(screenX, screenY - height + size/2);
    ctx.lineTo(screenX, screenY + size/2);
    ctx.lineTo(screenX - size/2, screenY + size/4);
    ctx.closePath();
    ctx.fill(); ctx.stroke();

    // Right
    ctx.fillStyle = colors.color;
    ctx.beginPath();
    ctx.moveTo(screenX + size/2, screenY - height + size/4);
    ctx.lineTo(screenX, screenY - height + size/2);
    ctx.lineTo(screenX, screenY + size/2);
    ctx.lineTo(screenX + size/2, screenY + size/4);
    ctx.closePath();
    ctx.fill(); ctx.stroke();

    drawHealthBar(screenX, screenY, health, isLocal);
}

// Get all players for rendering
function getAllPlayersForRendering() {
    const players = [{ x: player.x, y: player.y, colors: player, isLocal: true, health: player.health }];
    for (const [id, p] of Object.entries(otherPlayers)) {
        players.push({ x: p.x, y: p.y, colors: p, isLocal: false, health: p.health || MAX_HEALTH });
    }
    players.sort((a, b) => (a.x + a.y) - (b.x + b.y));
    return players;
}

// Main render
function render() {
    const cameraIso = worldToIso(player.x, player.y);
    drawWorld(cameraIso.x, cameraIso.y);
    for (const p of getAllPlayersForRendering()) {
        drawIsoPlayer(p.x, p.y, p.colors, p.isLocal, p.health, cameraIso.x, cameraIso.y);
    }
    ctx.fillStyle = '#fff';
    ctx.font = '14px monospace';
    ctx.fillText(`Health: ${player.health}/${MAX_HEALTH}`, 10, canvas.height - 30);
    ctx.fillText(`SPACE/CLICK to attack`, 10, canvas.height - 10);
}

// Game loop
let lastTime = 0;
function gameLoop(timestamp) {
    const dt = Math.min((timestamp - lastTime) / 1000, 0.1);
    lastTime = timestamp;
    updatePlayer(dt);
    sendPosition();
    render();
    requestAnimationFrame(gameLoop);
}

// Start
connectToServer();
requestAnimationFrame(gameLoop);
