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
const MAX_POINTS = 10;

// Default ability constants (for guests/default spells)
const MISSILE_SPEED = 400;
const MISSILE_DAMAGE = 1;
const MISSILE_COOLDOWN = 300;
const DASH_DISTANCE = 100;
const DASH_COOLDOWN = 1000;
const FIREBALL_SPEED = 200;
const FIREBALL_DAMAGE = 2;
const FIREBALL_RADIUS = 80;
const FIREBALL_COOLDOWN = 15000;

// Spell stat mappings (0-10 scale for most stats)
const SPELL_STATS = {
    damage: { min: -10, max: 10 }, // negative = healing
    aoe: [0, 25, 50, 75, 100, 125, 150, 175, 200, 225, 250], // pixels (0-10)
    speed: [200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700], // px/s (0-10)
    cooldown: [2000, 1820, 1640, 1460, 1280, 1100, 920, 740, 560, 380, 200], // ms (0-10)
    range: [1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000], // ms lifetime (0-10)
    projectileCount: [1, 2, 3, 4],
    homing: [0, 0.02, 0.05], // turn rate
    knockback: [0, 50, 100, 150, 200, 250] // pixels push (0-5)
};

// Sprite palette
const SPRITE_PALETTE = [
    'transparent', '#ff0000', '#ff8800', '#ffff00',
    '#00ff00', '#00ffff', '#0088ff', '#ff00ff'
];

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
    gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
}
function playDeathSound() { playSound(120, 0.4); setTimeout(() => playSound(80, 0.3), 150); }
function playHitSound() { playSound(100, 0.1, 'square'); }
function playShootSound() { playSound(200, 0.1, 'sawtooth'); }
function playDashSound() { playSound(150, 0.15, 'triangle'); }
function playFireballSound() { playSound(80, 0.5, 'sawtooth'); }
function playExplosionSound() { playSound(50, 0.4, 'square'); }

// Account state
let accountState = {
    accountId: null,
    username: null,
    teamId: null,
    teamName: null,
    teamColor: null,
    spells: [],
    equippedSpells: [null, null, null]
};

// Game state
const MAX_SHIELD = 4;

let player = {
    x: SPAWN_X, y: SPAWN_Y,
    color: playerColor, colorDark: playerColorDark, colorLight: playerColorLight,
    hue: playerHue, facingRight: true, health: MAX_HEALTH, shield: 0,
    lastDir: { x: 1, y: 0 },
    kills: 0, deaths: 0,
    spellUses: {}
};

let otherPlayers = {};
let projectiles = [];
let explosions = [];
let lastUpdateTime = 0;
let ws = null;
let connected = false;
let authenticated = false;
let showLeaderboard = false;
let leaderboardData = [];
let gameStarted = false;

// Cooldowns (per slot)
let lastSpellTime = [0, 0, 0];
let lastPunchTime = 0;

// Selected ability slot (0-2)
let selectedSlot = 0;

// Input
const input = { up: false, down: false, left: false, right: false };

// Default spells for guests
const defaultSpells = [
    { name: 'Missile', points_damage: 1, points_aoe: 0, points_speed: 2, points_cooldown: 3, points_range: 1, points_projectile_count: 0, points_homing: 0 },
    { name: 'Dash', isDash: true },
    { name: 'Fireball', points_damage: 2, points_aoe: 2, points_speed: 0, points_cooldown: 0, points_range: 1, points_projectile_count: 0, points_homing: 0 }
];

// Sprite editor state
let spriteEditorState = {
    pixels: new Array(64).fill(0),
    selectedColor: 1,
    painting: false
};

let editingSpellId = null;

// ============== AUTH UI ==============

const authModal = document.getElementById('auth-modal');
const authForm = document.getElementById('auth-form');
const authTitle = document.getElementById('auth-title');
const authSubmit = document.getElementById('auth-submit');
const authToggle = document.getElementById('auth-toggle');
const authError = document.getElementById('auth-error');
const guestPlay = document.getElementById('guest-play');
const hudButtons = document.getElementById('hud-buttons');

let isRegistering = false;

authToggle.addEventListener('click', (e) => {
    e.preventDefault();
    isRegistering = !isRegistering;
    authTitle.textContent = isRegistering ? 'Create Account' : 'Login';
    authSubmit.textContent = isRegistering ? 'Register' : 'Login';
    authToggle.textContent = isRegistering ? 'Back to Login' : 'Create Account';
    authError.textContent = '';
});

authForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const username = document.getElementById('auth-username').value.trim();
    const password = document.getElementById('auth-password').value;

    if (!ws || ws.readyState !== WebSocket.OPEN) {
        authError.textContent = 'Not connected to server. Please wait...';
        return;
    }

    if (username.length < 3) {
        authError.textContent = 'Username must be at least 3 characters';
        return;
    }

    if (password.length < 4) {
        authError.textContent = 'Password must be at least 4 characters';
        return;
    }

    authError.textContent = '';
    authSubmit.disabled = true;
    authSubmit.textContent = 'Please wait...';

    ws.send(JSON.stringify({
        type: isRegistering ? 'register' : 'login',
        username,
        password
    }));
});

guestPlay.addEventListener('click', (e) => {
    e.preventDefault();
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        authError.textContent = 'Not connected to server. Please wait...';
        return;
    }
    ws.send(JSON.stringify({ type: 'guest_play' }));
});

document.getElementById('logout-btn').addEventListener('click', () => {
    localStorage.removeItem('mage_account_id');
    localStorage.removeItem('mage_username');
    location.reload();
});

// ============== SPELL MODAL ==============

const spellModal = document.getElementById('spell-modal');
const spriteCanvas = document.getElementById('sprite-canvas');
const spriteCtx = spriteCanvas.getContext('2d');

document.getElementById('open-spells-btn').addEventListener('click', () => {
    if (!accountState.accountId) {
        alert('You must be logged in to create spells');
        return;
    }
    openSpellModal();
});

document.getElementById('spell-modal-close').addEventListener('click', () => {
    spellModal.classList.add('hidden');
});

function openSpellModal() {
    spellModal.classList.remove('hidden');
    resetSpellEditor();
    renderSpellList();
    renderEquippedSlots();
    initPalette();
    renderSpriteCanvas();
}

function resetSpellEditor() {
    document.getElementById('spell-name').value = '';
    document.getElementById('stat-damage').value = 0;
    document.getElementById('stat-aoe').value = 0;
    document.getElementById('stat-speed').value = 0;
    document.getElementById('stat-cooldown').value = 0;
    document.getElementById('stat-range').value = 0;
    document.getElementById('stat-multishot').value = 0;
    document.getElementById('stat-homing').value = 0;
    document.getElementById('stat-knockback').value = 0;
    spriteEditorState.pixels = new Array(64).fill(0);
    editingSpellId = null;
    document.getElementById('delete-spell').classList.add('hidden');
    updateStatDisplays();
    updatePointsRemaining();
}

function loadSpellIntoEditor(spell) {
    document.getElementById('spell-name').value = spell.name;
    document.getElementById('stat-damage').value = spell.points_damage;
    document.getElementById('stat-aoe').value = spell.points_aoe;
    document.getElementById('stat-speed').value = spell.points_speed;
    document.getElementById('stat-cooldown').value = spell.points_cooldown;
    document.getElementById('stat-range').value = spell.points_range;
    document.getElementById('stat-multishot').value = spell.points_projectile_count;
    document.getElementById('stat-homing').value = spell.points_homing;
    document.getElementById('stat-knockback').value = spell.points_knockback || 0;

    if (spell.sprite_pixels) {
        spriteEditorState.pixels = spell.sprite_pixels.split(',').map(Number);
    } else {
        spriteEditorState.pixels = new Array(64).fill(0);
    }

    editingSpellId = spell.id;
    document.getElementById('delete-spell').classList.remove('hidden');
    updateStatDisplays();
    updatePointsRemaining();
    renderSpriteCanvas();
}

// Stat sliders
document.querySelectorAll('.stat-row input[type="range"]').forEach(slider => {
    slider.addEventListener('input', () => {
        updateStatDisplays();
        updatePointsRemaining();
    });
});

function updateStatDisplays() {
    document.querySelectorAll('.stat-row').forEach(row => {
        const slider = row.querySelector('input[type="range"]');
        const valueSpan = row.querySelector('.stat-value');
        if (slider && valueSpan) {
            valueSpan.textContent = slider.value;
        }
    });
}

function calculatePointsUsed() {
    const damage = parseInt(document.getElementById('stat-damage').value);
    const aoe = parseInt(document.getElementById('stat-aoe').value);
    const speed = parseInt(document.getElementById('stat-speed').value);
    const cooldown = parseInt(document.getElementById('stat-cooldown').value);
    const range = parseInt(document.getElementById('stat-range').value);
    const multishot = parseInt(document.getElementById('stat-multishot').value);
    const homing = parseInt(document.getElementById('stat-homing').value);
    const knockback = parseInt(document.getElementById('stat-knockback').value);

    // Damage uses absolute value - healing costs points too
    // Multishot costs 3 per level, Homing costs 2 per level, Knockback costs 2 per level
    return Math.abs(damage) + aoe + speed + cooldown + range + (multishot * 3) + (homing * 2) + (knockback * 2);
}

function updatePointsRemaining() {
    const used = calculatePointsUsed();
    const remaining = MAX_POINTS - used;
    const container = document.getElementById('points-remaining');
    container.querySelector('span').textContent = remaining;

    if (remaining < 0) {
        container.classList.add('over-budget');
    } else {
        container.classList.remove('over-budget');
    }
}

// Palette
function initPalette() {
    const palette = document.getElementById('color-palette');
    palette.innerHTML = '';
    SPRITE_PALETTE.forEach((color, i) => {
        const div = document.createElement('div');
        div.className = 'palette-color' + (i === spriteEditorState.selectedColor ? ' selected' : '');
        if (i === 0) {
            div.classList.add('transparent-color');
        } else {
            div.style.background = color;
        }
        div.addEventListener('click', () => {
            document.querySelectorAll('.palette-color').forEach(c => c.classList.remove('selected'));
            div.classList.add('selected');
            spriteEditorState.selectedColor = i;
        });
        palette.appendChild(div);
    });
}

// Sprite canvas
function renderSpriteCanvas() {
    const pixelSize = 20;
    spriteCtx.fillStyle = '#0d0d1a';
    spriteCtx.fillRect(0, 0, 160, 160);

    // Draw checkerboard for transparency
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            const i = y * 8 + x;
            const colorIndex = spriteEditorState.pixels[i];

            if (colorIndex === 0) {
                // Checkerboard pattern
                spriteCtx.fillStyle = (x + y) % 2 === 0 ? '#222' : '#333';
            } else {
                spriteCtx.fillStyle = SPRITE_PALETTE[colorIndex];
            }
            spriteCtx.fillRect(x * pixelSize, y * pixelSize, pixelSize, pixelSize);
        }
    }

    // Grid lines
    spriteCtx.strokeStyle = '#444';
    spriteCtx.lineWidth = 1;
    for (let i = 0; i <= 8; i++) {
        spriteCtx.beginPath();
        spriteCtx.moveTo(i * pixelSize, 0);
        spriteCtx.lineTo(i * pixelSize, 160);
        spriteCtx.stroke();
        spriteCtx.beginPath();
        spriteCtx.moveTo(0, i * pixelSize);
        spriteCtx.lineTo(160, i * pixelSize);
        spriteCtx.stroke();
    }
}

spriteCanvas.addEventListener('mousedown', (e) => {
    spriteEditorState.painting = true;
    paintPixel(e);
});

spriteCanvas.addEventListener('mousemove', (e) => {
    if (spriteEditorState.painting) paintPixel(e);
});

spriteCanvas.addEventListener('mouseup', () => {
    spriteEditorState.painting = false;
});

spriteCanvas.addEventListener('mouseleave', () => {
    spriteEditorState.painting = false;
});

function paintPixel(e) {
    const rect = spriteCanvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / 20);
    const y = Math.floor((e.clientY - rect.top) / 20);
    if (x >= 0 && x < 8 && y >= 0 && y < 8) {
        spriteEditorState.pixels[y * 8 + x] = spriteEditorState.selectedColor;
        renderSpriteCanvas();
    }
}

document.getElementById('clear-sprite').addEventListener('click', () => {
    spriteEditorState.pixels = new Array(64).fill(0);
    renderSpriteCanvas();
});

// Save spell
document.getElementById('save-spell').addEventListener('click', () => {
    const name = document.getElementById('spell-name').value.trim();
    if (!name) {
        alert('Please enter a spell name');
        return;
    }

    const pointsUsed = calculatePointsUsed();
    if (pointsUsed > MAX_POINTS) {
        alert('Too many points used!');
        return;
    }

    const spellData = {
        name,
        points: {
            damage: parseInt(document.getElementById('stat-damage').value),
            aoe: parseInt(document.getElementById('stat-aoe').value),
            speed: parseInt(document.getElementById('stat-speed').value),
            cooldown: parseInt(document.getElementById('stat-cooldown').value),
            range: parseInt(document.getElementById('stat-range').value),
            projectileCount: parseInt(document.getElementById('stat-multishot').value),
            homing: parseInt(document.getElementById('stat-homing').value),
            knockback: parseInt(document.getElementById('stat-knockback').value)
        },
        sprite: {
            size: 8,
            pixels: spriteEditorState.pixels.join(','),
            palette: SPRITE_PALETTE.join(',')
        }
    };

    if (ws && ws.readyState === WebSocket.OPEN) {
        if (editingSpellId) {
            ws.send(JSON.stringify({
                type: 'update_spell',
                accountId: accountState.accountId,
                spellId: editingSpellId,
                ...spellData
            }));
        } else {
            ws.send(JSON.stringify({
                type: 'create_spell',
                accountId: accountState.accountId,
                ...spellData
            }));
        }
    }
});

document.getElementById('delete-spell').addEventListener('click', () => {
    if (!editingSpellId) return;
    if (!confirm('Delete this spell?')) return;

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'delete_spell',
            accountId: accountState.accountId,
            spellId: editingSpellId
        }));
    }
    resetSpellEditor();
});

function renderSpellList() {
    const container = document.getElementById('my-spells');
    container.innerHTML = '';

    accountState.spells.forEach(spell => {
        const div = document.createElement('div');
        div.className = 'spell-item' + (editingSpellId === spell.id ? ' selected' : '');

        // Mini sprite preview
        const miniCanvas = document.createElement('canvas');
        miniCanvas.width = 24;
        miniCanvas.height = 24;
        renderSpellSprite(miniCanvas, spell, 3);
        div.appendChild(miniCanvas);

        const nameSpan = document.createElement('span');
        nameSpan.className = 'spell-item-name';
        nameSpan.textContent = spell.name;
        div.appendChild(nameSpan);

        div.addEventListener('click', () => {
            loadSpellIntoEditor(spell);
            document.querySelectorAll('.spell-item').forEach(s => s.classList.remove('selected'));
            div.classList.add('selected');
        });

        // Drag to equip
        div.draggable = true;
        div.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('spellId', spell.id);
        });

        container.appendChild(div);
    });
}

function renderEquippedSlots() {
    const slots = document.querySelectorAll('.equip-slot');
    slots.forEach((slot, i) => {
        const spell = accountState.equippedSpells[i];
        slot.innerHTML = '';
        slot.classList.remove('filled');

        if (spell) {
            slot.classList.add('filled');

            const miniCanvas = document.createElement('canvas');
            miniCanvas.width = 24;
            miniCanvas.height = 24;
            renderSpellSprite(miniCanvas, spell, 3);
            slot.appendChild(miniCanvas);

            const nameDiv = document.createElement('div');
            nameDiv.textContent = `[${i + 1}] ${spell.name}`;
            slot.appendChild(nameDiv);
        } else {
            slot.textContent = `Slot ${i + 1} (Empty)`;
        }
    });

    // Drop handlers
    slots.forEach((slot, i) => {
        slot.addEventListener('dragover', (e) => e.preventDefault());
        slot.addEventListener('drop', (e) => {
            e.preventDefault();
            const spellId = e.dataTransfer.getData('spellId');
            if (spellId && ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'equip_spell',
                    accountId: accountState.accountId,
                    spellId,
                    slot: i
                }));
            }
        });

        // Click to unequip
        slot.addEventListener('dblclick', () => {
            if (accountState.equippedSpells[i] && ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'unequip_spell',
                    accountId: accountState.accountId,
                    slot: i
                }));
            }
        });
    });
}

function renderSpellSprite(canvas, spell, pixelSize) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!spell.sprite_pixels) return;

    const pixels = spell.sprite_pixels.split(',').map(Number);
    const palette = spell.sprite_palette ? spell.sprite_palette.split(',') : SPRITE_PALETTE;

    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            const colorIndex = pixels[y * 8 + x];
            if (colorIndex !== 0) {
                ctx.fillStyle = palette[colorIndex] || SPRITE_PALETTE[colorIndex];
                ctx.fillRect(x * pixelSize, y * pixelSize, pixelSize, pixelSize);
            }
        }
    }
}

// ============== TEAM MODAL ==============

const teamModal = document.getElementById('team-modal');

document.getElementById('open-teams-btn').addEventListener('click', () => {
    if (!accountState.accountId) {
        alert('You must be logged in to join teams');
        return;
    }
    openTeamModal();
});

document.getElementById('team-modal-close').addEventListener('click', () => {
    teamModal.classList.add('hidden');
});

function openTeamModal() {
    teamModal.classList.remove('hidden');
    updateTeamUI();
}

function updateTeamUI() {
    const currentInfo = document.getElementById('current-team-info');
    const options = document.getElementById('team-options');

    if (accountState.teamId) {
        currentInfo.classList.remove('hidden');
        document.getElementById('current-team-name').textContent = accountState.teamName;
        document.getElementById('current-team-color-preview').style.background = accountState.teamColor;
    } else {
        currentInfo.classList.add('hidden');
    }
}

document.getElementById('create-team').addEventListener('click', () => {
    const name = document.getElementById('new-team-name').value.trim();
    const color = document.getElementById('new-team-color').value;

    if (!name) {
        document.getElementById('team-error').textContent = 'Please enter a team name';
        return;
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'create_team',
            accountId: accountState.accountId,
            name,
            color
        }));
    }
});

document.getElementById('join-team').addEventListener('click', () => {
    const teamName = document.getElementById('join-team-name').value.trim();

    if (!teamName) {
        document.getElementById('team-error').textContent = 'Please enter a team name';
        return;
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'join_team',
            accountId: accountState.accountId,
            teamName
        }));
    }
});

document.getElementById('leave-team').addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'leave_team',
            accountId: accountState.accountId
        }));
    }
});

// ============== RESIZE & INPUT ==============

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

window.addEventListener('keydown', (e) => {
    if (!gameStarted) return;
    if (document.activeElement.tagName === 'INPUT') return;

    switch (e.key.toLowerCase()) {
        case 'w': case 'arrowup': input.up = true; break;
        case 's': case 'arrowdown': input.down = true; break;
        case 'a': case 'arrowleft': input.left = true; break;
        case 'd': case 'arrowright': input.right = true; break;
        case ' ': tryPunch(); e.preventDefault(); break;
        case '1': selectedSlot = 0; break;
        case '2': selectedSlot = 1; break;
        case '3': selectedSlot = 2; break;
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

// Auto-fire when holding click
let mouseDown = false;
let mouseX = 0;
let mouseY = 0;

canvas.addEventListener('mousedown', (e) => {
    if (!gameStarted) return;

    // Check if clicking on ability buttons
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const btnWidth = 100, btnHeight = 40, btnGap = 10;
    const totalWidth = btnWidth * 3 + btnGap * 2;
    const startX = (canvas.width - totalWidth) / 2;
    const btnY = canvas.height - 60;

    for (let i = 0; i < 3; i++) {
        const x = startX + i * (btnWidth + btnGap);
        if (mx >= x && mx <= x + btnWidth && my >= btnY && my <= btnY + btnHeight) {
            selectedSlot = i;
            return; // Don't start firing
        }
    }

    mouseDown = true;
    mouseX = e.clientX - rect.left - canvas.width / 2;
    mouseY = e.clientY - rect.top - canvas.height / 2;
    useAbility(mouseX, mouseY);
});

canvas.addEventListener('mousemove', (e) => {
    if (!gameStarted || !mouseDown) return;
    const rect = canvas.getBoundingClientRect();
    mouseX = e.clientX - rect.left - canvas.width / 2;
    mouseY = e.clientY - rect.top - canvas.height / 2;
});

canvas.addEventListener('mouseup', () => {
    mouseDown = false;
});

canvas.addEventListener('mouseleave', () => {
    mouseDown = false;
});

// ============== COORDINATE HELPERS ==============

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

const PLAYER_HITBOX_WIDTH = 40;
const PLAYER_HITBOX_HEIGHT = 40;

function checkRectCollision(x1, y1, x2, y2, range) {
    let dx = x2 - x1;
    let dy = y2 - y1;
    if (dx > WORLD_PIXELS / 2) dx -= WORLD_PIXELS;
    if (dx < -WORLD_PIXELS / 2) dx += WORLD_PIXELS;
    if (dy > WORLD_PIXELS / 2) dy -= WORLD_PIXELS;
    if (dy < -WORLD_PIXELS / 2) dy += WORLD_PIXELS;
    return Math.abs(dx) < range && Math.abs(dy) < range;
}

function findNearestPlayer(range) {
    let nearest = null, nearestDist = Infinity;
    for (const [id, p] of Object.entries(otherPlayers)) {
        if (checkRectCollision(player.x, player.y, p.x, p.y, range)) {
            const dist = getWrappedDistance(player.x, player.y, p.x, p.y);
            if (dist < nearestDist) { nearestDist = dist; nearest = id; }
        }
    }
    return nearest;
}

// ============== COMBAT ==============

function tryPunch() {
    const now = Date.now();
    if (now - lastPunchTime < PUNCH_COOLDOWN) return;
    const targetId = findNearestPlayer(ATTACK_RANGE);
    if (!targetId) return;
    lastPunchTime = now;
    player.spellUses.punch = (player.spellUses.punch || 0) + 1;
    playHitSound();
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "attack", targetId, damage: 1, spell: 'punch' }));
    }
}

function getSpellForSlot(slot) {
    // For logged in users with equipped spells
    if (accountState.accountId && accountState.equippedSpells[slot]) {
        return accountState.equippedSpells[slot];
    }
    // Default spells for guests
    return defaultSpells[slot];
}

function getSpellStats(spell) {
    if (!spell) return null;
    if (spell.isDash) return { isDash: true, cooldown: DASH_COOLDOWN };

    return {
        damage: spell.points_damage,
        aoe: SPELL_STATS.aoe[spell.points_aoe] || 0,
        speed: SPELL_STATS.speed[spell.points_speed] || 200,
        cooldown: SPELL_STATS.cooldown[spell.points_cooldown] || 2000,
        range: SPELL_STATS.range[spell.points_range] || 1000,
        projectileCount: SPELL_STATS.projectileCount[spell.points_projectile_count] || 1,
        homing: SPELL_STATS.homing[spell.points_homing] || 0,
        knockback: SPELL_STATS.knockback[spell.points_knockback] || 0,
        sprite_pixels: spell.sprite_pixels,
        sprite_palette: spell.sprite_palette,
        name: spell.name
    };
}

function useAbility(clickX, clickY) {
    const now = Date.now();
    const spell = getSpellForSlot(selectedSlot);
    if (!spell) return;

    const stats = getSpellStats(spell);
    if (!stats) return;

    if (now - lastSpellTime[selectedSlot] < stats.cooldown) return;

    // Calculate direction from click
    let dirX = clickX, dirY = clickY;
    const len = Math.sqrt(dirX * dirX + dirY * dirY);
    if (len > 0) { dirX /= len; dirY /= len; }
    else { dirX = player.lastDir.x; dirY = player.lastDir.y; }

    // Convert screen direction to world direction
    const worldDirX = dirX + dirY * 2;
    const worldDirY = -dirX + dirY * 2;
    const wlen = Math.sqrt(worldDirX * worldDirX + worldDirY * worldDirY);
    const normDirX = worldDirX / wlen;
    const normDirY = worldDirY / wlen;

    if (stats.isDash) {
        lastSpellTime[selectedSlot] = now;
        player.spellUses.dash = (player.spellUses.dash || 0) + 1;
        playDashSound();
        player.x = wrapPosition(player.x + normDirX * DASH_DISTANCE);
        player.y = wrapPosition(player.y + normDirY * DASH_DISTANCE);
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "spell_use", spell: 'dash' }));
        }
        return;
    }

    lastSpellTime[selectedSlot] = now;
    const spellName = spell.name || 'custom';
    player.spellUses[spellName] = (player.spellUses[spellName] || 0) + 1;

    if (stats.aoe > 0) {
        playFireballSound();
    } else {
        playShootSound();
    }

    // Spawn projectiles (multishot)
    const count = stats.projectileCount;
    const spreadAngle = count > 1 ? 0.3 : 0; // 30 degrees total spread

    for (let i = 0; i < count; i++) {
        let angle = Math.atan2(normDirY, normDirX);
        if (count > 1) {
            angle += spreadAngle * (i / (count - 1) - 0.5);
        }

        const projDirX = Math.cos(angle);
        const projDirY = Math.sin(angle);

        spawnProjectile(stats, projDirX, projDirY);
    }
}

function spawnProjectile(stats, dirX, dirY) {
    const proj = {
        id: `${playerId}_${Date.now()}_${Math.random()}`,
        x: player.x,
        y: player.y,
        dirX, dirY,
        ownerId: playerId,
        speed: stats.speed,
        damage: stats.damage,
        aoe: stats.aoe,
        homing: stats.homing,
        knockback: stats.knockback,
        range: stats.range,
        hue: playerHue,
        born: Date.now(),
        sprite_pixels: stats.sprite_pixels,
        sprite_palette: stats.sprite_palette,
        spellName: stats.name
    };
    projectiles.push(proj);

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "projectile", ...proj }));
    }
}

// ============== PROJECTILE UPDATE ==============

function updateProjectiles(dt) {
    const now = Date.now();

    for (let i = projectiles.length - 1; i >= 0; i--) {
        const p = projectiles[i];

        // Homing behavior
        if (p.homing > 0 && p.ownerId === playerId) {
            let nearestDist = Infinity;
            let nearestTarget = null;

            for (const [id, other] of Object.entries(otherPlayers)) {
                const dist = getWrappedDistance(p.x, p.y, other.x, other.y);
                if (dist < nearestDist && dist < 300) {
                    nearestDist = dist;
                    nearestTarget = other;
                }
            }

            if (nearestTarget) {
                let targetDx = nearestTarget.x - p.x;
                let targetDy = nearestTarget.y - p.y;
                if (targetDx > WORLD_PIXELS / 2) targetDx -= WORLD_PIXELS;
                if (targetDx < -WORLD_PIXELS / 2) targetDx += WORLD_PIXELS;
                if (targetDy > WORLD_PIXELS / 2) targetDy -= WORLD_PIXELS;
                if (targetDy < -WORLD_PIXELS / 2) targetDy += WORLD_PIXELS;

                const targetAngle = Math.atan2(targetDy, targetDx);
                const currentAngle = Math.atan2(p.dirY, p.dirX);

                let angleDiff = targetAngle - currentAngle;
                while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

                const turnAmount = Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), p.homing);
                const newAngle = currentAngle + turnAmount;

                p.dirX = Math.cos(newAngle);
                p.dirY = Math.sin(newAngle);
            }
        }

        // Move
        p.x = wrapPosition(p.x + p.dirX * p.speed * dt);
        p.y = wrapPosition(p.y + p.dirY * p.speed * dt);

        // Check lifetime
        const lifetime = p.range || 3000;
        if (now - p.born > lifetime) {
            projectiles.splice(i, 1);
            continue;
        }

        // Check collision (only our projectiles)
        if (p.ownerId === playerId) {
            const hitRange = (p.aoe > 0) ? 35 : 25;

            for (const [id, other] of Object.entries(otherPlayers)) {
                if (checkRectCollision(p.x, p.y, other.x, other.y, hitRange)) {
                    if (p.aoe > 0) {
                        // Explosion
                        createExplosion(p.x, p.y, p.hue, p.aoe);
                        playExplosionSound();

                        for (const [eid, eplayer] of Object.entries(otherPlayers)) {
                            if (checkRectCollision(p.x, p.y, eplayer.x, eplayer.y, p.aoe)) {
                                if (ws && ws.readyState === WebSocket.OPEN) {
                                    ws.send(JSON.stringify({
                                        type: "attack",
                                        targetId: eid,
                                        damage: p.damage,
                                        knockback: p.knockback || 0,
                                        knockbackDirX: p.dirX,
                                        knockbackDirY: p.dirY,
                                        spell: p.spellName || 'custom'
                                    }));
                                }
                            }
                        }
                    } else {
                        // Direct hit
                        if (ws && ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({
                                type: "attack",
                                targetId: id,
                                damage: p.damage,
                                knockback: p.knockback || 0,
                                knockbackDirX: p.dirX,
                                knockbackDirY: p.dirY,
                                spell: p.spellName || 'custom'
                            }));
                        }
                    }
                    projectiles.splice(i, 1);
                    break;
                }
            }
        }
    }
}

function createExplosion(x, y, hue, radius = FIREBALL_RADIUS) {
    explosions.push({ x, y, hue, born: Date.now(), radius: 0, maxRadius: radius });
}

function updateExplosions() {
    const now = Date.now();
    for (let i = explosions.length - 1; i >= 0; i--) {
        const e = explosions[i];
        const age = now - e.born;
        e.radius = (age / 300) * (e.maxRadius || FIREBALL_RADIUS);
        if (age > 300) explosions.splice(i, 1);
    }
}

// ============== PLAYER UPDATE ==============

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
        facingRight: player.facingRight,
        username: accountState.username,
        accountId: accountState.accountId,
        teamId: accountState.teamId,
        teamColor: accountState.teamColor,
        teamName: accountState.teamName,
        equippedSpells: accountState.equippedSpells
    }));
}

// ============== CONNECT ==============

function connectToServer() {
    const wsUrl = 'wss://multiplayer-test.averyopela1.workers.dev/ws?room=default';
    playerCountEl.textContent = 'Connecting...';
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        connected = true;
        playerCountEl.textContent = 'Connected';
        // Check for saved session
        const savedAccountId = localStorage.getItem('mage_account_id');
        if (savedAccountId) {
            ws.send(JSON.stringify({ type: 'get_account_data', accountId: savedAccountId }));
        }
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            handleServerMessage(data);
        } catch (e) { console.error('Parse error:', e); }
    };

    ws.onclose = () => {
        connected = false;
        playerCountEl.textContent = 'Reconnecting...';
        setTimeout(connectToServer, 2000);
    };
    ws.onerror = () => {};
}

function handleServerMessage(data) {
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

        case 'auth_success':
            accountState.accountId = data.accountId;
            accountState.username = data.username;
            accountState.teamId = data.teamId;
            accountState.teamName = data.teamName;
            accountState.teamColor = data.teamColor;
            accountState.spells = data.spells || [];
            accountState.equippedSpells = data.equippedSpells || [null, null, null];

            if (data.accountId) {
                localStorage.setItem('mage_account_id', data.accountId);
                localStorage.setItem('mage_username', data.username);
            }

            authenticated = true;
            gameStarted = true;
            authModal.classList.add('hidden');
            hudButtons.classList.remove('hidden');
            sendPosition();
            break;

        case 'auth_error':
            authError.textContent = data.message;
            authSubmit.disabled = false;
            authSubmit.textContent = isRegistering ? 'Register' : 'Login';
            break;

        case 'account_data':
            if (data.data) {
                accountState.accountId = data.data.id;
                accountState.username = data.data.username;
                accountState.teamId = data.data.team_id;
                accountState.teamName = data.data.teamName;
                accountState.teamColor = data.data.teamColor;
                accountState.spells = data.data.spells || [];
                accountState.equippedSpells = data.data.equippedSpells || [null, null, null];

                authenticated = true;
                gameStarted = true;
                authModal.classList.add('hidden');
                hudButtons.classList.remove('hidden');
                sendPosition();
            }
            break;

        case 'spells_updated':
            accountState.spells = data.spells || [];
            if (data.equippedSpells) {
                accountState.equippedSpells = data.equippedSpells;
            }
            renderSpellList();
            renderEquippedSlots();
            resetSpellEditor();
            break;

        case 'equipped_updated':
            accountState.equippedSpells = data.equippedSpells || [null, null, null];
            renderEquippedSlots();
            break;

        case 'spell_error':
            alert(data.message);
            break;

        case 'team_joined':
            accountState.teamId = data.teamId;
            accountState.teamName = data.teamName;
            accountState.teamColor = data.teamColor;
            document.getElementById('team-error').textContent = '';
            updateTeamUI();
            break;

        case 'team_left':
            accountState.teamId = null;
            accountState.teamName = null;
            accountState.teamColor = null;
            updateTeamUI();
            break;

        case 'team_error':
            document.getElementById('team-error').textContent = data.message;
            break;

        case 'player_update':
            if (data.id !== playerId) {
                const isNew = !otherPlayers[data.id];
                otherPlayers[data.id] = {
                    x: data.x, y: data.y, hue: data.hue, facingRight: data.facingRight,
                    color: `hsl(${data.hue}, 70%, 50%)`,
                    colorDark: `hsl(${data.hue}, 70%, 35%)`,
                    colorLight: `hsl(${data.hue}, 70%, 65%)`,
                    health: data.health || MAX_HEALTH,
                    lastSeen: Date.now(),
                    username: data.username,
                    teamId: data.teamId,
                    teamColor: data.teamColor,
                    teamName: data.teamName,
                    equippedSpells: data.equippedSpells
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
                const dmg = data.damage || 1;

                if (dmg < 0) {
                    // Healing spell - negative damage
                    const healAmount = Math.abs(dmg);
                    if (player.health >= MAX_HEALTH) {
                        // At max health, add to shield instead
                        player.shield = Math.min(MAX_SHIELD, player.shield + healAmount);
                    } else {
                        player.health += healAmount;
                        if (player.health > MAX_HEALTH) {
                            // Overflow goes to shield
                            const overflow = player.health - MAX_HEALTH;
                            player.health = MAX_HEALTH;
                            player.shield = Math.min(MAX_SHIELD, player.shield + overflow);
                        }
                    }
                } else {
                    // Taking damage - shield takes half damage from projectiles
                    let remainingDmg = dmg;
                    if (player.shield > 0) {
                        // Shield takes half damage
                        const shieldDmg = dmg * 0.5;
                        if (player.shield >= shieldDmg) {
                            player.shield -= shieldDmg;
                            remainingDmg = 0;
                        } else {
                            // Shield depleted, remaining damage at full to health
                            remainingDmg = (shieldDmg - player.shield) * 2;
                            player.shield = 0;
                        }
                    }
                    player.health -= remainingDmg;
                }

                // Apply knockback
                if (data.knockback && data.knockbackDirX !== undefined) {
                    player.x = wrapPosition(player.x + data.knockbackDirX * data.knockback);
                    player.y = wrapPosition(player.y + data.knockbackDirY * data.knockback);
                }
                playHitSound();
                if (player.health <= 0) {
                    playDeathSound();
                    player.deaths++;
                    player.x = SPAWN_X; player.y = SPAWN_Y; player.health = MAX_HEALTH;
                    player.shield = 0; // Reset shield on death
                }
            }
            if (otherPlayers[data.targetId]) {
                const other = otherPlayers[data.targetId];
                const dmg = data.damage || 1;

                if (dmg < 0) {
                    // Healing
                    const healAmount = Math.abs(dmg);
                    if (!other.shield) other.shield = 0;
                    if (other.health >= MAX_HEALTH) {
                        other.shield = Math.min(MAX_SHIELD, other.shield + healAmount);
                    } else {
                        other.health += healAmount;
                        if (other.health > MAX_HEALTH) {
                            const overflow = other.health - MAX_HEALTH;
                            other.health = MAX_HEALTH;
                            other.shield = Math.min(MAX_SHIELD, other.shield + overflow);
                        }
                    }
                } else {
                    // Taking damage
                    if (!other.shield) other.shield = 0;
                    let remainingDmg = dmg;
                    if (other.shield > 0) {
                        const shieldDmg = dmg * 0.5;
                        if (other.shield >= shieldDmg) {
                            other.shield -= shieldDmg;
                            remainingDmg = 0;
                        } else {
                            remainingDmg = (shieldDmg - other.shield) * 2;
                            other.shield = 0;
                        }
                    }
                    other.health -= remainingDmg;
                }

                // Apply knockback to other players visually
                if (data.knockback && data.knockbackDirX !== undefined) {
                    other.x = wrapPosition(other.x + data.knockbackDirX * data.knockback);
                    other.y = wrapPosition(other.y + data.knockbackDirY * data.knockback);
                }
                if (other.health <= 0) {
                    playDeathSound();
                    other.health = MAX_HEALTH;
                    other.shield = 0; // Reset shield on death
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
                player.shield = 0; // Reset shield on respawn
            } else if (otherPlayers[data.id]) {
                otherPlayers[data.id].x = data.x;
                otherPlayers[data.id].y = data.y;
                otherPlayers[data.id].health = MAX_HEALTH;
                otherPlayers[data.id].shield = 0; // Reset shield on respawn
            }
            break;

        case 'projectile':
            if (data.ownerId !== playerId) {
                data.born = Date.now();
                if (!data.speed) data.speed = 300;
                projectiles.push(data);
            }
            break;
    }
}

function updatePlayerCount() {
    playerCountEl.textContent = `Players: ${Object.keys(otherPlayers).length + 1}`;
}

function cleanupStalePlayers() {
    const now = Date.now();
    const staleTimeout = 5000;
    let removed = false;

    for (const [id, p] of Object.entries(otherPlayers)) {
        if (p.lastSeen && now - p.lastSeen > staleTimeout) {
            delete otherPlayers[id];
            removed = true;
        }
    }

    if (removed) updatePlayerCount();
}

// ============== RENDERING ==============

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

function drawHealthBar(screenX, screenY, health, isLocal, shield = 0) {
    const barWidth = 30, barHeight = 4, y = screenY - 45;

    // Health bar
    ctx.fillStyle = '#333';
    ctx.fillRect(screenX - barWidth / 2, y, barWidth, barHeight);
    ctx.fillStyle = health > 2 ? '#4ade80' : health > 1 ? '#fbbf24' : '#ef4444';
    ctx.fillRect(screenX - barWidth / 2, y, (health / MAX_HEALTH) * barWidth, barHeight);
    ctx.strokeStyle = isLocal ? '#fff' : '#888';
    ctx.lineWidth = 1;
    ctx.strokeRect(screenX - barWidth / 2, y, barWidth, barHeight);

    // Shield bar (above health bar, cyan color)
    if (shield > 0) {
        const shieldY = y - 6;
        ctx.fillStyle = '#333';
        ctx.fillRect(screenX - barWidth / 2, shieldY, barWidth, barHeight);
        ctx.fillStyle = '#00ffff'; // Cyan for shield
        ctx.fillRect(screenX - barWidth / 2, shieldY, (shield / MAX_SHIELD) * barWidth, barHeight);
        ctx.strokeStyle = isLocal ? '#fff' : '#888';
        ctx.strokeRect(screenX - barWidth / 2, shieldY, barWidth, barHeight);
    }
}

function drawUsername(screenX, screenY, username, teamColor) {
    if (!username) return;

    ctx.font = '12px monospace';
    ctx.textAlign = 'center';

    // Team color indicator
    if (teamColor) {
        ctx.fillStyle = teamColor;
        ctx.fillRect(screenX - ctx.measureText(username).width / 2 - 4, screenY - 62, ctx.measureText(username).width + 8, 16);
        ctx.fillStyle = '#fff';
    } else {
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(screenX - ctx.measureText(username).width / 2 - 2, screenY - 62, ctx.measureText(username).width + 4, 14);
        ctx.fillStyle = '#fff';
    }

    ctx.fillText(username, screenX, screenY - 50);
    ctx.textAlign = 'left';
}

function drawIsoPlayer(worldX, worldY, colors, isLocal, health, cameraIsoX, cameraIsoY, username, teamColor, shield = 0) {
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

    // Team ring
    if (teamColor) {
        ctx.beginPath();
        ctx.ellipse(screenX, screenY + 5, size / 2 + 4, size / 4 + 2, 0, 0, Math.PI * 2);
        ctx.strokeStyle = teamColor;
        ctx.lineWidth = 3;
        ctx.stroke();
    }

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

    drawHealthBar(screenX, screenY, health, isLocal, shield);
    drawUsername(screenX, screenY, username, teamColor);
}

function drawProjectiles(cameraIsoX, cameraIsoY) {
    const centerX = canvas.width / 2, centerY = canvas.height / 2;

    for (const p of projectiles) {
        const iso = worldToIso(p.x, p.y);
        const screenX = centerX + iso.x - cameraIsoX;
        const screenY = centerY + iso.y - cameraIsoY;

        // Custom sprite
        if (p.sprite_pixels) {
            const pixels = p.sprite_pixels.split(',').map(Number);
            const palette = p.sprite_palette ? p.sprite_palette.split(',') : SPRITE_PALETTE;
            const pixelSize = 2;

            for (let y = 0; y < 8; y++) {
                for (let x = 0; x < 8; x++) {
                    const colorIndex = pixels[y * 8 + x];
                    if (colorIndex !== 0) {
                        ctx.fillStyle = palette[colorIndex] || SPRITE_PALETTE[colorIndex];
                        ctx.fillRect(
                            screenX - 8 + x * pixelSize,
                            screenY - 23 + y * pixelSize,
                            pixelSize, pixelSize
                        );
                    }
                }
            }
        } else if (p.aoe > 0) {
            // Fireball-like
            ctx.beginPath();
            ctx.arc(screenX, screenY - 15, 12, 0, Math.PI * 2);
            const grad = ctx.createRadialGradient(screenX, screenY - 15, 0, screenX, screenY - 15, 12);
            grad.addColorStop(0, '#ffff00');
            grad.addColorStop(0.5, '#ff6600');
            grad.addColorStop(1, '#ff0000');
            ctx.fillStyle = grad;
            ctx.fill();
        } else {
            // Default missile
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

        const maxRadius = e.maxRadius || FIREBALL_RADIUS;
        const alpha = 1 - (e.radius / maxRadius);
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

    for (let i = 0; i < 3; i++) {
        const spell = getSpellForSlot(i);
        const stats = getSpellStats(spell);
        const x = startX + i * (btnWidth + btnGap);
        const isSelected = selectedSlot === i;
        const cooldown = stats ? stats.cooldown : 1000;
        const cdRemaining = Math.max(0, cooldown - (now - lastSpellTime[i]));
        const cdRatio = cdRemaining / cooldown;

        // Button color
        let btnColor = '#333';
        if (isSelected) {
            if (spell && spell.isDash) {
                btnColor = '#44ff88';
            } else if (stats && stats.aoe > 0) {
                btnColor = '#ff6644';
            } else {
                btnColor = '#4488ff';
            }
        }

        ctx.fillStyle = btnColor;
        ctx.fillRect(x, btnY, btnWidth, btnHeight);

        if (cdRatio > 0) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.fillRect(x, btnY, btnWidth * cdRatio, btnHeight);
        }

        ctx.strokeStyle = isSelected ? '#fff' : '#666';
        ctx.lineWidth = isSelected ? 3 : 1;
        ctx.strokeRect(x, btnY, btnWidth, btnHeight);

        ctx.fillStyle = '#fff';
        ctx.font = '14px monospace';
        ctx.textAlign = 'center';

        const spellName = spell ? (spell.name || 'Empty') : 'Empty';
        ctx.fillText(`[${i + 1}] ${spellName.substring(0, 8)}`, x + btnWidth / 2, btnY + 25);

        if (cdRemaining > 0) {
            ctx.fillStyle = '#ff0';
            ctx.fillText((cdRemaining / 1000).toFixed(1) + 's', x + btnWidth / 2, btnY + 12);
        }
    }

    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.font = '14px monospace';

    const displayName = accountState.username || 'Guest';
    const shieldText = player.shield > 0 ? ` | Shield: ${player.shield.toFixed(1)}/${MAX_SHIELD}` : '';
    ctx.fillText(`${displayName} | Health: ${player.health}/${MAX_HEALTH}${shieldText}`, 10, canvas.height - 80);
    ctx.fillText(`Kills: ${player.kills} | Deaths: ${player.deaths} | KDR: ${player.deaths > 0 ? (player.kills / player.deaths).toFixed(2) : player.kills.toFixed(2)}`, 10, canvas.height - 100);

    if (accountState.teamName) {
        ctx.fillStyle = accountState.teamColor || '#fff';
        ctx.fillText(`Team: ${accountState.teamName}`, 10, canvas.height - 120);
        ctx.fillStyle = '#fff';
    }

    ctx.fillStyle = '#888';
    ctx.fillText(`SPACE = Punch | CLICK = Use Spell | TAB = Leaderboard`, 10, canvas.height - 140);
}

function drawLeaderboard() {
    if (!showLeaderboard) return;

    const padding = 20;
    const rowHeight = 30;
    const width = 600;
    const height = Math.min(400, padding * 2 + rowHeight * (leaderboardData.length + 1));
    const x = (canvas.width - width) / 2;
    const y = (canvas.height - height) / 2;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, width, height);

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('LEADERBOARD (Hold TAB)', x + width / 2, y + 25);

    ctx.font = '12px monospace';
    ctx.fillStyle = '#888';
    const cols = [30, 150, 250, 310, 370, 480];
    ctx.textAlign = 'left';
    ctx.fillText('#', x + cols[0], y + 50);
    ctx.fillText('Player', x + cols[1], y + 50);
    ctx.fillText('Team', x + cols[2], y + 50);
    ctx.fillText('Kills', x + cols[3], y + 50);
    ctx.fillText('Deaths', x + cols[4], y + 50);
    ctx.fillText('Most Used', x + cols[5], y + 50);

    const sorted = [...leaderboardData].sort((a, b) => b.kills - a.kills);

    let hasPlayer = sorted.some(p => p.id === playerId);
    if (!hasPlayer && playerId) {
        sorted.push({
            id: playerId,
            hue: playerHue,
            kills: player.kills,
            deaths: player.deaths,
            spellUses: player.spellUses,
            username: accountState.username,
            teamName: accountState.teamName,
            teamColor: accountState.teamColor
        });
        sorted.sort((a, b) => b.kills - a.kills);
    }

    ctx.font = '14px monospace';
    sorted.slice(0, 10).forEach((p, i) => {
        const rowY = y + 70 + i * rowHeight;
        const isMe = p.id === playerId;

        if (isMe) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
            ctx.fillRect(x + 10, rowY - 15, width - 20, rowHeight - 2);
        }

        // Rank
        ctx.fillStyle = isMe ? '#fff' : '#ccc';
        ctx.fillText((i + 1).toString(), x + cols[0], rowY);

        // Player name with color indicator
        ctx.fillStyle = `hsl(${p.hue}, 70%, 50%)`;
        ctx.fillRect(x + cols[1] - 20, rowY - 10, 15, 15);

        ctx.fillStyle = isMe ? '#fff' : '#ccc';
        const displayName = p.username || `Player ${p.id.split('_')[1]}`;
        ctx.fillText(displayName.substring(0, 12), x + cols[1], rowY);

        // Team
        if (p.teamName) {
            ctx.fillStyle = p.teamColor || '#888';
            ctx.fillText(p.teamName.substring(0, 8), x + cols[2], rowY);
        } else {
            ctx.fillStyle = '#666';
            ctx.fillText('-', x + cols[2], rowY);
        }

        // Stats
        ctx.fillStyle = isMe ? '#fff' : '#ccc';
        ctx.fillText(p.kills.toString(), x + cols[3], rowY);
        ctx.fillText(p.deaths.toString(), x + cols[4], rowY);

        // Most used spell
        const spells = p.spellUses || {};
        let mostUsed = 'None';
        let maxUses = 0;
        for (const [spell, uses] of Object.entries(spells)) {
            if (uses > maxUses) {
                maxUses = uses;
                mostUsed = spell.charAt(0).toUpperCase() + spell.slice(1);
            }
        }
        ctx.fillText(mostUsed.substring(0, 10) + (maxUses > 0 ? ` (${maxUses})` : ''), x + cols[5], rowY);
    });
}

function getAllPlayersForRendering() {
    const players = [{
        x: player.x, y: player.y, colors: player, isLocal: true,
        health: player.health, username: accountState.username,
        teamColor: accountState.teamColor, shield: player.shield
    }];

    for (const [id, p] of Object.entries(otherPlayers)) {
        players.push({
            x: p.x, y: p.y, colors: p, isLocal: false,
            health: p.health || MAX_HEALTH, username: p.username,
            teamColor: p.teamColor, shield: p.shield || 0
        });
    }
    players.sort((a, b) => (a.x + a.y) - (b.x + b.y));
    return players;
}

function render() {
    const cameraIso = worldToIso(player.x, player.y);
    drawWorld(cameraIso.x, cameraIso.y);
    drawExplosions(cameraIso.x, cameraIso.y);

    for (const p of getAllPlayersForRendering()) {
        drawIsoPlayer(p.x, p.y, p.colors, p.isLocal, p.health, cameraIso.x, cameraIso.y, p.username, p.teamColor, p.shield);
    }

    drawProjectiles(cameraIso.x, cameraIso.y);
    drawUI();
    drawLeaderboard();
}

let lastTime = 0;
let lastCleanup = 0;
function gameLoop(timestamp) {
    const dt = Math.min((timestamp - lastTime) / 1000, 0.1);
    lastTime = timestamp;

    if (gameStarted) {
        updatePlayer(dt);
        updateProjectiles(dt);
        updateExplosions();
        sendPosition();

        // Auto-fire when holding mouse
        if (mouseDown) {
            useAbility(mouseX, mouseY);
        }

        if (timestamp - lastCleanup > 1000) {
            cleanupStalePlayers();
            lastCleanup = timestamp;
        }
    }

    render();
    requestAnimationFrame(gameLoop);
}

connectToServer();
requestAnimationFrame(gameLoop);
