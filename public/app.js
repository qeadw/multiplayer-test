// Game constants
const TILE_SIZE = 64;
const TILES_PER_CHUNK = 8;
const CHUNK_SIZE = TILE_SIZE * TILES_PER_CHUNK;
const WORLD_SIZE = 3;
const WORLD_PIXELS = CHUNK_SIZE * WORLD_SIZE;
const PLAYER_SPEED = 150;
const UPDATE_RATE = 50;
const ATTACK_RANGE = 60;
const PUNCH_COOLDOWN = 500;
const MAX_HEALTH = 4;
const SPAWN_X = WORLD_PIXELS / 2;
const SPAWN_Y = WORLD_PIXELS / 2;

// Ability constants
const MISSILE_SPEED = 400;
const MISSILE_DAMAGE = 1;
const MISSILE_COOLDOWN = 300;
const DASH_DISTANCE = 100;
const DASH_COOLDOWN = 1000;
const FIREBALL_SPEED = 200;
const FIREBALL_DAMAGE = 2;
const FIREBALL_RADIUS = 80;
const FIREBALL_COOLDOWN = 15000;

// Isometric constants
const ISO_TILE_WIDTH = 64;
const ISO_TILE_HEIGHT = 32;

// Player ID
let playerId = null;

// Player color
const playerHue = Math.random() * 360;
const playerColor = `hsl(${playerHue}, 70%, 50%)`;
const playerColorDark = `hsl(${playerHue}, 70%, 35%)`;
const playerColorLight = `hsl(${playerHue}, 70%, 65%)`;

// Canvas setup
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const playerCountEl = document.getElementById('player-count');

// Pre-rendered world
let worldCanvas = null;
let worldCtx = null;
let worldRendered = false;

// Audio
let audioCtx = null;
function playSound(freq, duration, type = 'sine') {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
}
function playDeathSound() { playSound(400, 0.3); setTimeout(() => playSound(200, 0.2), 100); }
function playHitSound() { playSound(200, 0.1, 'square'); }
function playShootSound() { playSound(600, 0.1, 'sawtooth'); }
function playDashSound() { playSound(300, 0.15, 'triangle'); }
function playFireballSound() { playSound(150, 0.4, 'sawtooth'); }
function playExplosionSound() { playSound(80, 0.3, 'square'); }

// Game state
let player = {
    x: SPAWN_X, y: SPAWN_Y,
    color: playerColor, colorDark: playerColorDark, colorLight: playerColorLight,
    hue: playerHue, facingRight: true, health: MAX_HEALTH,
    lastDir: { x: 1, y: 0 },
    kills: 0, deaths: 0,
    spellUses: { missile: 0, dash: 0, fireball: 0, punch: 0 }
};

let otherPlayers = {};
let projectiles = [];
let explosions = [];
let lastUpdateTime = 0;
let ws = null;
let connected = false;
let showLeaderboard = false;
let leaderboardData = [];

// Cooldowns
let lastPunchTime = 0;
let lastMissileTime = 0;
let lastDashTime = 0;
let lastFireballTime = 0;

// Selected ability
let selectedAbility = 'missile'; // 'missile', 'dash', 'fireball'

// Input
const input = { up: false, down: false, left: false, right: false };

// Resize
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
        case ' ': tryPunch(); e.preventDefault(); break;
        case '1': selectedAbility = 'missile'; break;
        case '2': selectedAbility = 'dash'; break;
        case '3': selectedAbility = 'fireball'; break;
        case 'tab':
            showLeaderboard = true;
            requestLeaderboard();
            e.preventDefault();
            break;
    }
});

window.addEventListener('keyup', (e) => {
    switch (e.key.toLowerCase()) {
        case 'w': case 'arrowup': input.up = false; break;
        case 's': case 'arrowdown': input.down = false; break;
        case 'a': case 'arrowleft': input.left = false; break;
        case 'd': case 'arrowright': input.right = false; break;
        case 'tab': showLeaderboard = false; break;
    }
});

function requestLeaderboard() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "get_leaderboard" }));
    }
}

// Click to use ability
canvas.addEventListener('click', (e) => {
    // Get click direction
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left - canvas.width / 2;
    const clickY = e.clientY - rect.top - canvas.height / 2;
    useAbility(clickX, clickY);
});

// Coordinate helpers
function worldToIso(x, y) {
    return {
        x: (x - y) * (ISO_TILE_WIDTH / TILE_SIZE / 2),
        y: (x + y) * (ISO_TILE_HEIGHT / TILE_SIZE / 2)
    };
}

function wrapPosition(pos) {
    if (pos < 0) return pos + WORLD_PIXELS;
    if (pos >= WORLD_PIXELS) return pos - WORLD_PIXELS;
    return pos;
}

function getDistance(x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
}

function getWrappedDistance(x1, y1, x2, y2) {
    let dx = x2 - x1;
    let dy = y2 - y1;
    if (dx > WORLD_PIXELS / 2) dx -= WORLD_PIXELS;
    if (dx < -WORLD_PIXELS / 2) dx += WORLD_PIXELS;
    if (dy > WORLD_PIXELS / 2) dy -= WORLD_PIXELS;
    if (dy < -WORLD_PIXELS / 2) dy += WORLD_PIXELS;
    return Math.sqrt(dx * dx + dy * dy);
}

// Find nearest player in range
function findNearestPlayer(range) {
    let nearest = null, nearestDist = range;
    for (const [id, p] of Object.entries(otherPlayers)) {
        const dist = getWrappedDistance(player.x, player.y, p.x, p.y);
        if (dist < nearestDist) { nearestDist = dist; nearest = id; }
    }
    return nearest;
}

// Punch (melee)
function tryPunch() {
    const now = Date.now();
    if (now - lastPunchTime < PUNCH_COOLDOWN) return;
    const targetId = findNearestPlayer(ATTACK_RANGE);
    if (!targetId) return;
    lastPunchTime = now;
    player.spellUses.punch++;
    playHitSound();
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "attack", targetId, damage: 1, spell: 'punch' }));
    }
}

// Use selected ability
function useAbility(clickX, clickY) {
    const now = Date.now();

    // Calculate direction from click
    let dirX = clickX, dirY = clickY;
    const len = Math.sqrt(dirX * dirX + dirY * dirY);
    if (len > 0) { dirX /= len; dirY /= len; }
    else { dirX = player.lastDir.x; dirY = player.lastDir.y; }

    // Convert screen direction to world direction (reverse isometric)
    const worldDirX = dirX + dirY * 2;
    const worldDirY = -dirX + dirY * 2;
    const wlen = Math.sqrt(worldDirX * worldDirX + worldDirY * worldDirY);
    const normDirX = worldDirX / wlen;
    const normDirY = worldDirY / wlen;

    switch (selectedAbility) {
        case 'missile':
            if (now - lastMissileTime < MISSILE_COOLDOWN) return;
            lastMissileTime = now;
            player.spellUses.missile++;
            playShootSound();
            spawnProjectile('missile', normDirX, normDirY);
            break;

        case 'dash':
            if (now - lastDashTime < DASH_COOLDOWN) return;
            lastDashTime = now;
            player.spellUses.dash++;
            playDashSound();
            player.x = wrapPosition(player.x + normDirX * DASH_DISTANCE);
            player.y = wrapPosition(player.y + normDirY * DASH_DISTANCE);
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: "spell_use", spell: 'dash' }));
            }
            break;

        case 'fireball':
            if (now - lastFireballTime < FIREBALL_COOLDOWN) return;
            lastFireballTime = now;
            player.spellUses.fireball++;
            playFireballSound();
            spawnProjectile('fireball', normDirX, normDirY);
            break;
    }
}

// Spawn projectile
function spawnProjectile(type, dirX, dirY) {
    const proj = {
        id: `${playerId}_${Date.now()}`,
        type,
        x: player.x,
        y: player.y,
        dirX, dirY,
        ownerId: playerId,
        speed: type === 'fireball' ? FIREBALL_SPEED : MISSILE_SPEED,
        damage: type === 'fireball' ? FIREBALL_DAMAGE : MISSILE_DAMAGE,
        hue: playerHue,
        born: Date.now()
    };
    projectiles.push(proj);

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "projectile", ...proj }));
    }
}

// Update projectiles
function updateProjectiles(dt) {
    const now = Date.now();

    for (let i = projectiles.length - 1; i >= 0; i--) {
        const p = projectiles[i];

        // Move
        p.x = wrapPosition(p.x + p.dirX * p.speed * dt);
        p.y = wrapPosition(p.y + p.dirY * p.speed * dt);

        // Check lifetime (3 seconds max)
        if (now - p.born > 3000) {
            projectiles.splice(i, 1);
            continue;
        }

        // Check collision with players (only check our own projectiles)
        if (p.ownerId === playerId) {
            for (const [id, other] of Object.entries(otherPlayers)) {
                const dist = getWrappedDistance(p.x, p.y, other.x, other.y);
                const hitRadius = p.type === 'fireball' ? 30 : 20;

                if (dist < hitRadius) {
                    if (p.type === 'fireball') {
                        // Explosion damages all nearby
                        createExplosion(p.x, p.y, p.hue);
                        playExplosionSound();

                        // Damage all players in radius
                        for (const [eid, eplayer] of Object.entries(otherPlayers)) {
                            const edist = getWrappedDistance(p.x, p.y, eplayer.x, eplayer.y);
                            if (edist < FIREBALL_RADIUS) {
                                if (ws && ws.readyState === WebSocket.OPEN) {
                                    ws.send(JSON.stringify({ type: "attack", targetId: eid, damage: FIREBALL_DAMAGE, spell: 'fireball' }));
                                }
                            }
                        }
                    } else {
                        // Direct hit
                        if (ws && ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({ type: "attack", targetId: id, damage: p.damage, spell: 'missile' }));
                        }
                    }
                    projectiles.splice(i, 1);
                    break;
                }
            }
        }
    }
}

// Create explosion effect
function createExplosion(x, y, hue) {
    explosions.push({ x, y, hue, born: Date.now(), radius: 0 });
}

// Update explosions
function updateExplosions() {
    const now = Date.now();
    for (let i = explosions.length - 1; i >= 0; i--) {
        const e = explosions[i];
        const age = now - e.born;
        e.radius = (age / 300) * FIREBALL_RADIUS;
        if (age > 300) explosions.splice(i, 1);
    }
}

// Update player
function updatePlayer(dt) {
    let vx = 0, vy = 0;
    if (input.up) { vx -= 1; vy -= 1; }
    if (input.down) { vx += 1; vy += 1; }
    if (input.left) { vx -= 1; vy += 1; }
    if (input.right) { vx += 1; vy -= 1; }

    if (vx !== 0 || vy !== 0) {
        const len = Math.sqrt(vx * vx + vy * vy);
        vx /= len; vy /= len;
        player.lastDir = { x: vx, y: vy };
    }

    player.x = wrapPosition(player.x + vx * PLAYER_SPEED * dt);
    player.y = wrapPosition(player.y + vy * PLAYER_SPEED * dt);
    if (vx > 0) player.facingRight = true;
    if (vx < 0) player.facingRight = false;
}

// Send position
function sendPosition() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    if (now - lastUpdateTime < UPDATE_RATE) return;
    lastUpdateTime = now;
    ws.send(JSON.stringify({
        type: "update", x: player.x, y: player.y, hue: player.hue, facingRight: player.facingRight
    }));
}

// Connect
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
                        player.health -= (data.damage || 1);
                        playHitSound();
                        if (player.health <= 0) {
                            playDeathSound();
                            player.deaths++;
                            player.x = SPAWN_X; player.y = SPAWN_Y; player.health = MAX_HEALTH;
                        }
                    }
                    if (otherPlayers[data.targetId]) {
                        otherPlayers[data.targetId].health -= (data.damage || 1);
                        if (otherPlayers[data.targetId].health <= 0) {
                            playDeathSound();
                            otherPlayers[data.targetId].health = MAX_HEALTH;
                        }
                    }
                    break;
                case 'kill':
                    if (data.killerId === playerId) {
                        player.kills = data.killerKills;
                    }
                    if (data.victimId === playerId) {
                        player.deaths = data.victimDeaths;
                    }
                    break;
                case 'leaderboard':
                    leaderboardData = data.players || [];
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
                case 'projectile':
                    if (data.ownerId !== playerId) {
                        projectiles.push(data);
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

// Pre-render world
function prerenderWorld() {
    const tilesX = TILES_PER_CHUNK * WORLD_SIZE;
    const tilesY = TILES_PER_CHUNK * WORLD_SIZE;
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

    for (let tx = 0; tx < tilesX; tx++) {
        for (let ty = 0; ty < tilesY; ty++) {
            const iso = worldToIso(tx * TILE_SIZE + TILE_SIZE / 2, ty * TILE_SIZE + TILE_SIZE / 2);
            const screenX = iso.x + offsetX;
            const screenY = iso.y + offsetY;
            const chunkX = Math.floor(tx / TILES_PER_CHUNK);
            const chunkY = Math.floor(ty / TILES_PER_CHUNK);
            const isEvenChunk = (chunkX + chunkY) % 2 === 0;
            const isEvenTile = (tx + ty) % 2 === 0;
            let color, stroke;
            if (isEvenChunk) {
                color = isEvenTile ? '#1e3a5f' : '#1a3152';
                stroke = '#2d5a8a';
            } else {
                color = isEvenTile ? '#2d1e5f' : '#261a52';
                stroke = '#4a2d8a';
            }
            drawIsoTile(worldCtx, screenX, screenY, color, stroke);
        }
    }
    worldRendered = true;
    worldCanvas.offsetX = offsetX;
    worldCanvas.offsetY = offsetY;
}

function drawIsoTile(context, screenX, screenY, color, strokeColor) {
    const hw = ISO_TILE_WIDTH / 2, hh = ISO_TILE_HEIGHT / 2;
    context.beginPath();
    context.moveTo(screenX, screenY - hh);
    context.lineTo(screenX + hw, screenY);
    context.lineTo(screenX, screenY + hh);
    context.lineTo(screenX - hw, screenY);
    context.closePath();
    context.fillStyle = color;
    context.fill();
    context.strokeStyle = strokeColor;
    context.lineWidth = 1;
    context.stroke();
}

function drawWorld(cameraIsoX, cameraIsoY) {
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!worldRendered) prerenderWorld();
    const drawX = canvas.width / 2 - cameraIsoX - worldCanvas.offsetX;
    const drawY = canvas.height / 2 - cameraIsoY - worldCanvas.offsetY;
    ctx.drawImage(worldCanvas, drawX, drawY);
}

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

function drawIsoPlayer(worldX, worldY, colors, isLocal, health, cameraIsoX, cameraIsoY) {
    const centerX = canvas.width / 2, centerY = canvas.height / 2;
    const iso = worldToIso(worldX, worldY);
    const screenX = centerX + iso.x - cameraIsoX;
    const screenY = centerY + iso.y - cameraIsoY;
    if (screenX < -50 || screenX > canvas.width + 50 || screenY < -50 || screenY > canvas.height + 50) return;

    const size = 20, height = 30;
    ctx.beginPath();
    ctx.ellipse(screenX, screenY + 5, size / 2, size / 4, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fill();

    ctx.strokeStyle = isLocal ? '#fff' : 'rgba(255,255,255,0.3)';
    ctx.lineWidth = isLocal ? 2 : 1;

    ctx.fillStyle = colors.colorLight;
    ctx.beginPath();
    ctx.moveTo(screenX, screenY - height);
    ctx.lineTo(screenX + size/2, screenY - height + size/4);
    ctx.lineTo(screenX, screenY - height + size/2);
    ctx.lineTo(screenX - size/2, screenY - height + size/4);
    ctx.closePath();
    ctx.fill(); ctx.stroke();

    ctx.fillStyle = colors.colorDark;
    ctx.beginPath();
    ctx.moveTo(screenX - size/2, screenY - height + size/4);
    ctx.lineTo(screenX, screenY - height + size/2);
    ctx.lineTo(screenX, screenY + size/2);
    ctx.lineTo(screenX - size/2, screenY + size/4);
    ctx.closePath();
    ctx.fill(); ctx.stroke();

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

function drawProjectiles(cameraIsoX, cameraIsoY) {
    const centerX = canvas.width / 2, centerY = canvas.height / 2;

    for (const p of projectiles) {
        const iso = worldToIso(p.x, p.y);
        const screenX = centerX + iso.x - cameraIsoX;
        const screenY = centerY + iso.y - cameraIsoY;

        if (p.type === 'fireball') {
            // Draw fireball (larger, orange)
            ctx.beginPath();
            ctx.arc(screenX, screenY - 15, 12, 0, Math.PI * 2);
            const grad = ctx.createRadialGradient(screenX, screenY - 15, 0, screenX, screenY - 15, 12);
            grad.addColorStop(0, '#ffff00');
            grad.addColorStop(0.5, '#ff6600');
            grad.addColorStop(1, '#ff0000');
            ctx.fillStyle = grad;
            ctx.fill();
        } else {
            // Draw missile (small, colored)
            ctx.beginPath();
            ctx.arc(screenX, screenY - 15, 5, 0, Math.PI * 2);
            ctx.fillStyle = `hsl(${p.hue}, 70%, 60%)`;
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1;
            ctx.stroke();
        }
    }
}

function drawExplosions(cameraIsoX, cameraIsoY) {
    const centerX = canvas.width / 2, centerY = canvas.height / 2;

    for (const e of explosions) {
        const iso = worldToIso(e.x, e.y);
        const screenX = centerX + iso.x - cameraIsoX;
        const screenY = centerY + iso.y - cameraIsoY;

        const alpha = 1 - (e.radius / FIREBALL_RADIUS);
        ctx.beginPath();
        ctx.arc(screenX, screenY, e.radius * 0.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 100, 0, ${alpha * 0.5})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(255, 200, 0, ${alpha})`;
        ctx.lineWidth = 3;
        ctx.stroke();
    }
}

function drawUI() {
    const now = Date.now();
    const btnWidth = 100, btnHeight = 40, btnGap = 10;
    const totalWidth = btnWidth * 3 + btnGap * 2;
    const startX = (canvas.width - totalWidth) / 2;
    const btnY = canvas.height - 60;

    const abilities = [
        { id: 'missile', name: 'Missile', key: '1', cooldown: MISSILE_COOLDOWN, lastUse: lastMissileTime, color: '#4488ff' },
        { id: 'dash', name: 'Dash', key: '2', cooldown: DASH_COOLDOWN, lastUse: lastDashTime, color: '#44ff88' },
        { id: 'fireball', name: 'Fireball', key: '3', cooldown: FIREBALL_COOLDOWN, lastUse: lastFireballTime, color: '#ff6644' }
    ];

    abilities.forEach((ab, i) => {
        const x = startX + i * (btnWidth + btnGap);
        const isSelected = selectedAbility === ab.id;
        const cdRemaining = Math.max(0, ab.cooldown - (now - ab.lastUse));
        const cdRatio = cdRemaining / ab.cooldown;

        // Button background
        ctx.fillStyle = isSelected ? ab.color : '#333';
        ctx.fillRect(x, btnY, btnWidth, btnHeight);

        // Cooldown overlay
        if (cdRatio > 0) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.fillRect(x, btnY, btnWidth * cdRatio, btnHeight);
        }

        // Border
        ctx.strokeStyle = isSelected ? '#fff' : '#666';
        ctx.lineWidth = isSelected ? 3 : 1;
        ctx.strokeRect(x, btnY, btnWidth, btnHeight);

        // Text
        ctx.fillStyle = '#fff';
        ctx.font = '14px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`[${ab.key}] ${ab.name}`, x + btnWidth / 2, btnY + 25);

        // Cooldown text
        if (cdRemaining > 0) {
            ctx.fillStyle = '#ff0';
            ctx.fillText((cdRemaining / 1000).toFixed(1) + 's', x + btnWidth / 2, btnY + 12);
        }
    });

    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.font = '14px monospace';
    ctx.fillText(`Health: ${player.health}/${MAX_HEALTH}`, 10, canvas.height - 80);
    ctx.fillText(`Kills: ${player.kills} | Deaths: ${player.deaths} | KDR: ${player.deaths > 0 ? (player.kills / player.deaths).toFixed(2) : player.kills.toFixed(2)}`, 10, canvas.height - 100);
    ctx.fillText(`SPACE = Punch | CLICK = Use Ability | TAB = Leaderboard`, 10, canvas.height - 120);
}

function drawLeaderboard() {
    if (!showLeaderboard) return;

    const padding = 20;
    const rowHeight = 30;
    const width = 500;
    const height = Math.min(400, padding * 2 + rowHeight * (leaderboardData.length + 1));
    const x = (canvas.width - width) / 2;
    const y = (canvas.height - height) / 2;

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, width, height);

    // Title
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('LEADERBOARD (Hold TAB)', x + width / 2, y + 25);

    // Headers
    ctx.font = '12px monospace';
    ctx.fillStyle = '#888';
    const cols = [50, 120, 180, 240, 340];
    ctx.textAlign = 'left';
    ctx.fillText('Color', x + cols[0], y + 50);
    ctx.fillText('Kills', x + cols[1], y + 50);
    ctx.fillText('Deaths', x + cols[2], y + 50);
    ctx.fillText('KDR', x + cols[3], y + 50);
    ctx.fillText('Most Used', x + cols[4], y + 50);

    // Sort by kills
    const sorted = [...leaderboardData].sort((a, b) => b.kills - a.kills);

    // Add current player if not in list
    let hasPlayer = sorted.some(p => p.id === playerId);
    if (!hasPlayer && playerId) {
        sorted.push({
            id: playerId,
            hue: playerHue,
            kills: player.kills,
            deaths: player.deaths,
            spellUses: player.spellUses
        });
        sorted.sort((a, b) => b.kills - a.kills);
    }

    // Rows
    ctx.font = '14px monospace';
    sorted.slice(0, 10).forEach((p, i) => {
        const rowY = y + 70 + i * rowHeight;
        const isMe = p.id === playerId;

        if (isMe) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
            ctx.fillRect(x + 10, rowY - 15, width - 20, rowHeight - 2);
        }

        // Color indicator
        ctx.fillStyle = `hsl(${p.hue}, 70%, 50%)`;
        ctx.fillRect(x + cols[0], rowY - 10, 20, 15);
        if (isMe) {
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.strokeRect(x + cols[0], rowY - 10, 20, 15);
        }

        // Stats
        ctx.fillStyle = isMe ? '#fff' : '#ccc';
        ctx.textAlign = 'left';
        ctx.fillText(p.kills.toString(), x + cols[1], rowY);
        ctx.fillText(p.deaths.toString(), x + cols[2], rowY);
        const kdr = p.deaths > 0 ? (p.kills / p.deaths).toFixed(2) : p.kills.toFixed(2);
        ctx.fillText(kdr, x + cols[3], rowY);

        // Most used spell
        const spells = p.spellUses || { missile: 0, dash: 0, fireball: 0, punch: 0 };
        let mostUsed = 'None';
        let maxUses = 0;
        for (const [spell, uses] of Object.entries(spells)) {
            if (uses > maxUses) {
                maxUses = uses;
                mostUsed = spell.charAt(0).toUpperCase() + spell.slice(1);
            }
        }
        ctx.fillText(mostUsed + (maxUses > 0 ? ` (${maxUses})` : ''), x + cols[4], rowY);
    });
}

// Handle button clicks
canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const btnWidth = 100, btnHeight = 40, btnGap = 10;
    const totalWidth = btnWidth * 3 + btnGap * 2;
    const startX = (canvas.width - totalWidth) / 2;
    const btnY = canvas.height - 60;

    const abilities = ['missile', 'dash', 'fireball'];
    abilities.forEach((ab, i) => {
        const x = startX + i * (btnWidth + btnGap);
        if (mx >= x && mx <= x + btnWidth && my >= btnY && my <= btnY + btnHeight) {
            selectedAbility = ab;
            e.stopPropagation();
        }
    });
});

function getAllPlayersForRendering() {
    const players = [{ x: player.x, y: player.y, colors: player, isLocal: true, health: player.health }];
    for (const [id, p] of Object.entries(otherPlayers)) {
        players.push({ x: p.x, y: p.y, colors: p, isLocal: false, health: p.health || MAX_HEALTH });
    }
    players.sort((a, b) => (a.x + a.y) - (b.x + b.y));
    return players;
}

function render() {
    const cameraIso = worldToIso(player.x, player.y);
    drawWorld(cameraIso.x, cameraIso.y);
    drawExplosions(cameraIso.x, cameraIso.y);
    for (const p of getAllPlayersForRendering()) {
        drawIsoPlayer(p.x, p.y, p.colors, p.isLocal, p.health, cameraIso.x, cameraIso.y);
    }
    drawProjectiles(cameraIso.x, cameraIso.y);
    drawUI();
    drawLeaderboard();
}

let lastTime = 0;
function gameLoop(timestamp) {
    const dt = Math.min((timestamp - lastTime) / 1000, 0.1);
    lastTime = timestamp;
    updatePlayer(dt);
    updateProjectiles(dt);
    updateExplosions();
    sendPosition();
    render();
    requestAnimationFrame(gameLoop);
}

connectToServer();
requestAnimationFrame(gameLoop);
