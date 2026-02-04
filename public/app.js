// Game constants
const TILE_SIZE = 64;
const TILES_PER_CHUNK = 8;
const CHUNK_SIZE = TILE_SIZE * TILES_PER_CHUNK;
const WORLD_SIZE = 3;
const WORLD_PIXELS = CHUNK_SIZE * WORLD_SIZE;
const PLAYER_SPEED = 150;
const UPDATE_RATE = 50;

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

// Game state
let player = {
    x: WORLD_PIXELS / 2,
    y: WORLD_PIXELS / 2,
    color: playerColor,
    colorDark: playerColorDark,
    colorLight: playerColorLight,
    hue: playerHue,
    facingRight: true
};

let otherPlayers = {};
let lastUpdateTime = 0;
let ws = null;
let connected = false;

// Input state
const input = {
    up: false,
    down: false,
    left: false,
    right: false
};

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

// Convert world coordinates to isometric screen coordinates
function worldToIso(x, y) {
    return {
        x: (x - y) * (ISO_TILE_WIDTH / TILE_SIZE / 2),
        y: (x + y) * (ISO_TILE_HEIGHT / TILE_SIZE / 2)
    };
}

// Wrap position (Pac-Man style)
function wrapPosition(pos) {
    while (pos < 0) pos += WORLD_PIXELS;
    while (pos >= WORLD_PIXELS) pos -= WORLD_PIXELS;
    return pos;
}

// Update player position
function updatePlayer(deltaTime) {
    let vx = 0;
    let vy = 0;

    if (input.up) { vx -= 1; vy -= 1; }
    if (input.down) { vx += 1; vy += 1; }
    if (input.left) { vx -= 1; vy += 1; }
    if (input.right) { vx += 1; vy -= 1; }

    if (vx !== 0 || vy !== 0) {
        const len = Math.sqrt(vx * vx + vy * vy);
        vx /= len;
        vy /= len;
    }

    player.x += vx * PLAYER_SPEED * deltaTime;
    player.y += vy * PLAYER_SPEED * deltaTime;

    player.x = wrapPosition(player.x);
    player.y = wrapPosition(player.y);

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
        type: "update",
        x: player.x,
        y: player.y,
        hue: player.hue,
        facingRight: player.facingRight
    }));
}

// Connect to server
function connectToServer() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws?room=default`;

    console.log('Connecting to:', wsUrl);
    playerCountEl.textContent = 'Connecting...';

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('Connected to server');
        connected = true;
        sendPosition();
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);

            switch (data.type) {
                case 'init':
                    playerId = data.yourId;
                    console.log('My ID:', playerId);
                    // Initialize other players from server state
                    for (const [id, pData] of Object.entries(data.players)) {
                        if (id !== playerId) {
                            otherPlayers[id] = {
                                ...pData,
                                color: `hsl(${pData.hue}, 70%, 50%)`,
                                colorDark: `hsl(${pData.hue}, 70%, 35%)`,
                                colorLight: `hsl(${pData.hue}, 70%, 65%)`
                            };
                        }
                    }
                    updatePlayerCount();
                    break;

                case 'player_update':
                    if (data.id !== playerId) {
                        otherPlayers[data.id] = {
                            x: data.x,
                            y: data.y,
                            hue: data.hue,
                            facingRight: data.facingRight,
                            color: `hsl(${data.hue}, 70%, 50%)`,
                            colorDark: `hsl(${data.hue}, 70%, 35%)`,
                            colorLight: `hsl(${data.hue}, 70%, 65%)`
                        };
                    }
                    break;

                case 'player_joined':
                    console.log('Player joined:', data.id);
                    updatePlayerCount();
                    break;

                case 'player_left':
                    console.log('Player left:', data.id);
                    delete otherPlayers[data.id];
                    updatePlayerCount();
                    break;
            }
        } catch (e) {
            console.error('Failed to parse message:', e);
        }
    };

    ws.onclose = () => {
        console.log('Disconnected from server');
        connected = false;
        playerCountEl.textContent = 'Disconnected - Reconnecting...';
        // Reconnect after 2 seconds
        setTimeout(connectToServer, 2000);
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
}

function updatePlayerCount() {
    const count = Object.keys(otherPlayers).length + 1;
    playerCountEl.textContent = `Players: ${count}`;
}

// Draw an isometric tile
function drawIsoTile(screenX, screenY, color1, color2, strokeColor) {
    const hw = ISO_TILE_WIDTH / 2;
    const hh = ISO_TILE_HEIGHT / 2;

    ctx.beginPath();
    ctx.moveTo(screenX, screenY - hh);
    ctx.lineTo(screenX + hw, screenY);
    ctx.lineTo(screenX, screenY + hh);
    ctx.lineTo(screenX - hw, screenY);
    ctx.closePath();

    const gradient = ctx.createLinearGradient(screenX - hw, screenY - hh, screenX + hw, screenY + hh);
    gradient.addColorStop(0, color1);
    gradient.addColorStop(1, color2);
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 1;
    ctx.stroke();
}

// Draw the world
function drawWorld(cameraIsoX, cameraIsoY) {
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    for (let wx = -1; wx <= 1; wx++) {
        for (let wy = -1; wy <= 1; wy++) {
            const worldOffsetX = wx * WORLD_PIXELS;
            const worldOffsetY = wy * WORLD_PIXELS;

            for (let tx = 0; tx < TILES_PER_CHUNK * WORLD_SIZE; tx++) {
                for (let ty = 0; ty < TILES_PER_CHUNK * WORLD_SIZE; ty++) {
                    const tileWorldX = tx * TILE_SIZE + worldOffsetX;
                    const tileWorldY = ty * TILE_SIZE + worldOffsetY;

                    const tileIso = worldToIso(tileWorldX + TILE_SIZE / 2, tileWorldY + TILE_SIZE / 2);
                    const screenX = centerX + tileIso.x - cameraIsoX;
                    const screenY = centerY + tileIso.y - cameraIsoY;

                    if (screenX < -ISO_TILE_WIDTH || screenX > canvas.width + ISO_TILE_WIDTH ||
                        screenY < -ISO_TILE_HEIGHT * 2 || screenY > canvas.height + ISO_TILE_HEIGHT * 2) {
                        continue;
                    }

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

                    drawIsoTile(screenX, screenY, color1, color2, stroke);
                }
            }
        }
    }

    // Draw world boundary
    const corners = [
        worldToIso(0, 0),
        worldToIso(WORLD_PIXELS, 0),
        worldToIso(WORLD_PIXELS, WORLD_PIXELS),
        worldToIso(0, WORLD_PIXELS)
    ];

    ctx.beginPath();
    ctx.moveTo(centerX + corners[0].x - cameraIsoX, centerY + corners[0].y - cameraIsoY);
    for (let i = 1; i < 4; i++) {
        ctx.lineTo(centerX + corners[i].x - cameraIsoX, centerY + corners[i].y - cameraIsoY);
    }
    ctx.closePath();
    ctx.strokeStyle = '#ff6b6b';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 10]);
    ctx.stroke();
    ctx.setLineDash([]);
}

// Draw an isometric player
function drawIsoPlayer(worldX, worldY, colors, isLocal, cameraIsoX, cameraIsoY) {
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    for (let wx = -1; wx <= 1; wx++) {
        for (let wy = -1; wy <= 1; wy++) {
            const px = worldX + wx * WORLD_PIXELS;
            const py = worldY + wy * WORLD_PIXELS;

            const iso = worldToIso(px, py);
            const screenX = centerX + iso.x - cameraIsoX;
            const screenY = centerY + iso.y - cameraIsoY;

            if (screenX < -50 || screenX > canvas.width + 50 ||
                screenY < -50 || screenY > canvas.height + 50) {
                continue;
            }

            const size = 20;
            const height = 30;

            // Top face
            ctx.beginPath();
            ctx.moveTo(screenX, screenY - height);
            ctx.lineTo(screenX + size / 2, screenY - height + size / 4);
            ctx.lineTo(screenX, screenY - height + size / 2);
            ctx.lineTo(screenX - size / 2, screenY - height + size / 4);
            ctx.closePath();
            ctx.fillStyle = colors.colorLight;
            ctx.fill();
            ctx.strokeStyle = isLocal ? '#fff' : 'rgba(255,255,255,0.3)';
            ctx.lineWidth = isLocal ? 2 : 1;
            ctx.stroke();

            // Left face
            ctx.beginPath();
            ctx.moveTo(screenX - size / 2, screenY - height + size / 4);
            ctx.lineTo(screenX, screenY - height + size / 2);
            ctx.lineTo(screenX, screenY + size / 2 - height + height);
            ctx.lineTo(screenX - size / 2, screenY + size / 4 - height + height);
            ctx.closePath();
            ctx.fillStyle = colors.colorDark;
            ctx.fill();
            ctx.stroke();

            // Right face
            ctx.beginPath();
            ctx.moveTo(screenX + size / 2, screenY - height + size / 4);
            ctx.lineTo(screenX, screenY - height + size / 2);
            ctx.lineTo(screenX, screenY + size / 2 - height + height);
            ctx.lineTo(screenX + size / 2, screenY + size / 4 - height + height);
            ctx.closePath();
            ctx.fillStyle = colors.color;
            ctx.fill();
            ctx.stroke();

            // Shadow
            ctx.beginPath();
            ctx.ellipse(screenX, screenY + 5, size / 2, size / 4, 0, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
            ctx.fill();
        }
    }
}

// Get all players for rendering
function getAllPlayersForRendering() {
    const players = [];

    players.push({
        x: player.x,
        y: player.y,
        colors: player,
        isLocal: true
    });

    for (const [id, p] of Object.entries(otherPlayers)) {
        players.push({
            x: p.x,
            y: p.y,
            colors: p,
            isLocal: false
        });
    }

    players.sort((a, b) => (a.x + a.y) - (b.x + b.y));
    return players;
}

// Main render function
function render() {
    const cameraIso = worldToIso(player.x, player.y);

    drawWorld(cameraIso.x, cameraIso.y);

    const players = getAllPlayersForRendering();
    for (const p of players) {
        drawIsoPlayer(p.x, p.y, p.colors, p.isLocal, cameraIso.x, cameraIso.y);
    }

    ctx.fillStyle = '#fff';
    ctx.font = '12px monospace';
    ctx.fillText(`Pos: ${Math.floor(player.x)}, ${Math.floor(player.y)}`, 10, canvas.height - 10);
}

// Game loop
let lastTime = 0;
function gameLoop(timestamp) {
    const deltaTime = (timestamp - lastTime) / 1000;
    lastTime = timestamp;

    const dt = Math.min(deltaTime, 0.1);

    updatePlayer(dt);
    sendPosition();
    render();

    requestAnimationFrame(gameLoop);
}

// Start
connectToServer();
requestAnimationFrame(gameLoop);
