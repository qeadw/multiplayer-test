import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js';
import {
    getDatabase,
    ref,
    set,
    onValue,
    onDisconnect,
    remove
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-database.js';

// Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyAOmXMwzVhnLpMsLiB8JzyT3ZVMG2w1JmE",
    authDomain: "feature-requests-7ee3c.firebaseapp.com",
    databaseURL: "https://feature-requests-7ee3c-default-rtdb.firebaseio.com",
    projectId: "feature-requests-7ee3c",
    storageBucket: "feature-requests-7ee3c.firebasestorage.app",
    messagingSenderId: "256362942849",
    appId: "1:256362942849:web:18b99ffe1341e9c3d05880"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Game constants
const TILE_SIZE = 64; // Size of each tile in world units
const TILES_PER_CHUNK = 8;
const CHUNK_SIZE = TILE_SIZE * TILES_PER_CHUNK;
const WORLD_SIZE = 3; // 3x3 chunks
const WORLD_PIXELS = CHUNK_SIZE * WORLD_SIZE;
const PLAYER_SPEED = 150;
const UPDATE_RATE = 50;

// Isometric constants
const ISO_TILE_WIDTH = 64;
const ISO_TILE_HEIGHT = 32;

// Generate a random player ID
const playerId = 'player_' + Math.random().toString(36).substr(2, 9);

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

    // WASD moves in world space (before isometric transform)
    if (input.up) { vx -= 1; vy -= 1; }
    if (input.down) { vx += 1; vy += 1; }
    if (input.left) { vx -= 1; vy += 1; }
    if (input.right) { vx += 1; vy -= 1; }

    // Normalize diagonal movement
    if (vx !== 0 || vy !== 0) {
        const len = Math.sqrt(vx * vx + vy * vy);
        vx /= len;
        vy /= len;
    }

    // Update position
    player.x += vx * PLAYER_SPEED * deltaTime;
    player.y += vy * PLAYER_SPEED * deltaTime;

    // Wrap position
    player.x = wrapPosition(player.x);
    player.y = wrapPosition(player.y);

    // Update facing direction
    if (vx > 0) player.facingRight = true;
    if (vx < 0) player.facingRight = false;
}

// Send position to Firebase
function sendPosition() {
    const now = Date.now();
    if (now - lastUpdateTime < UPDATE_RATE) return;
    lastUpdateTime = now;

    const playerRef = ref(db, `multiplayer-test/players/${playerId}`);
    set(playerRef, {
        x: player.x,
        y: player.y,
        hue: player.hue,
        facingRight: player.facingRight,
        timestamp: Date.now()
    });
}

// Initialize Firebase listeners
function initMultiplayer() {
    const playersRef = ref(db, 'multiplayer-test/players');

    onValue(playersRef, (snapshot) => {
        const data = snapshot.val() || {};
        otherPlayers = {};
        let count = 0;

        for (const [id, playerData] of Object.entries(data)) {
            count++;
            if (id !== playerId) {
                if (Date.now() - playerData.timestamp < 5000) {
                    otherPlayers[id] = {
                        ...playerData,
                        color: `hsl(${playerData.hue}, 70%, 50%)`,
                        colorDark: `hsl(${playerData.hue}, 70%, 35%)`,
                        colorLight: `hsl(${playerData.hue}, 70%, 65%)`
                    };
                }
            }
        }

        playerCountEl.textContent = `Players: ${count}`;
    });

    const playerRef = ref(db, `multiplayer-test/players/${playerId}`);
    onDisconnect(playerRef).remove();
    sendPosition();
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

    // Gradient fill
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

    // Draw tiles with wrapping
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

                    // Cull off-screen tiles
                    if (screenX < -ISO_TILE_WIDTH || screenX > canvas.width + ISO_TILE_WIDTH ||
                        screenY < -ISO_TILE_HEIGHT * 2 || screenY > canvas.height + ISO_TILE_HEIGHT * 2) {
                        continue;
                    }

                    // Chunk coloring
                    const chunkX = Math.floor(tx / TILES_PER_CHUNK);
                    const chunkY = Math.floor(ty / TILES_PER_CHUNK);
                    const isEvenChunk = (chunkX + chunkY) % 2 === 0;

                    // Tile coloring (checkerboard within chunk)
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

// Draw an isometric player (cube/character)
function drawIsoPlayer(worldX, worldY, colors, isLocal, cameraIsoX, cameraIsoY) {
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    // Draw player at all wrapped positions
    for (let wx = -1; wx <= 1; wx++) {
        for (let wy = -1; wy <= 1; wy++) {
            const px = worldX + wx * WORLD_PIXELS;
            const py = worldY + wy * WORLD_PIXELS;

            const iso = worldToIso(px, py);
            const screenX = centerX + iso.x - cameraIsoX;
            const screenY = centerY + iso.y - cameraIsoY;

            // Cull off-screen
            if (screenX < -50 || screenX > canvas.width + 50 ||
                screenY < -50 || screenY > canvas.height + 50) {
                continue;
            }

            // Draw isometric cube (player)
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

// Collect all players for depth sorting
function getAllPlayersForRendering() {
    const players = [];

    // Add local player
    players.push({
        x: player.x,
        y: player.y,
        colors: player,
        isLocal: true
    });

    // Add other players
    for (const [id, p] of Object.entries(otherPlayers)) {
        players.push({
            x: p.x,
            y: p.y,
            colors: p,
            isLocal: false
        });
    }

    // Sort by depth (y + x for isometric)
    players.sort((a, b) => (a.x + a.y) - (b.x + b.y));

    return players;
}

// Main render function
function render() {
    const cameraIso = worldToIso(player.x, player.y);

    drawWorld(cameraIso.x, cameraIso.y);

    // Get all players sorted by depth
    const players = getAllPlayersForRendering();

    // Draw all players
    for (const p of players) {
        drawIsoPlayer(p.x, p.y, p.colors, p.isLocal, cameraIso.x, cameraIso.y);
    }

    // Draw position info
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
initMultiplayer();
requestAnimationFrame(gameLoop);

// Clean up
window.addEventListener('beforeunload', () => {
    const playerRef = ref(db, `multiplayer-test/players/${playerId}`);
    remove(playerRef);
});
