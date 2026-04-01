const os = require('os');
const { WebSocketServer, WebSocket } = require('ws');

const MAX_PLAYERS = 4;
const DEFAULT_PORT = 7070;
const SUITS = ['bastoni', 'coppe', 'oro', 'spade'];
const RANKS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
const CARD_POINTS = {
  '1': 1,
  '2': 1 / 3,
  '3': 1 / 3,
  '8': 1 / 3,
  '9': 1 / 3,
  '10': 1 / 3
};
const ORDER_POWER = {
  '3': 10,
  '2': 9,
  '1': 8,
  '10': 7,
  '9': 6,
  '8': 5,
  '7': 4,
  '6': 3,
  '5': 2,
  '4': 1
};

const statusPill = document.getElementById('status-pill');
const playerNameInput = document.getElementById('player-name');
const pointLimitInput = document.getElementById('point-limit');
const hostBtn = document.getElementById('host-btn');
const joinInput = document.getElementById('join-url');
const joinBtn = document.getElementById('join-btn');
const hostUrlEl = document.getElementById('host-url');
const lobbyStatus = document.getElementById('lobby-status');
const startMatchBtn = document.getElementById('start-match-btn');
const trickCardsEl = document.getElementById('trick-cards');
const handEl = document.getElementById('player-hand');
const turnIndicator = document.getElementById('turn-indicator');
const trickIndicator = document.getElementById('trick-indicator');
const leaderboardEl = document.getElementById('leaderboard');
const eventLogEl = document.getElementById('event-log');

const slots = {
  top: document.getElementById('slot-top'),
  left: document.getElementById('slot-left'),
  right: document.getElementById('slot-right'),
  bottom: document.getElementById('slot-bottom')
};

let role = 'offline';
let localSeat = null;
let localPlayerId = null;
let wss = null;
let wsClient = null;
let hostState = null;

const uiState = {
  gameState: null,
  playerOrder: [],
  eventLog: []
};

function getDefaultName() {
  return `Giocatore-${Math.floor(Math.random() * 900 + 100)}`;
}

playerNameInput.value = getDefaultName();

function addLog(text, type = '') {
  uiState.eventLog.unshift({ text, type, ts: Date.now() });
  uiState.eventLog = uiState.eventLog.slice(0, 40);
  eventLogEl.innerHTML = uiState.eventLog
    .map((l) => `<div class="log-line ${l.type}">${new Date(l.ts).toLocaleTimeString()} - ${l.text}</div>`)
    .join('');
}

function setStatus(text, color = '#1e3a8a') {
  statusPill.textContent = text;
  statusPill.style.background = color;
}

function cardToImage(card) {
  return `carte/${card.suit}/${card.suit}_${card.rank}.jpg`;
}

function createDeck() {
  const d = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      d.push({ suit, rank, id: `${suit}#${rank}` });
    }
  }
  return d;
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function getPoints(card) {
  if (card.suit === 'bastoni' && card.rank === '1') return 11;
  return CARD_POINTS[card.rank] || 0;
}

function compareCards(a, b) {
  return ORDER_POWER[a.rank] - ORDER_POWER[b.rank];
}

function sortHand(hand) {
  return [...hand].sort((a, b) => {
    const suitCmp = SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
    if (suitCmp !== 0) return suitCmp;
    return ORDER_POWER[a.rank] - ORDER_POWER[b.rank];
  });
}

function getLocalIPv4() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const n of nets[name] || []) {
      if (n.family === 'IPv4' && !n.internal) return n.address;
    }
  }
  return '127.0.0.1';
}

function send(ws, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function broadcast(payload) {
  if (!hostState) return;
  for (const p of hostState.players) {
    if (p.socket) send(p.socket, payload);
  }
}

function buildViewForPlayer(playerId) {
  const state = hostState?.gameState;
  if (!state) return null;

  return {
    ...state,
    players: state.players.map((p) => ({
      ...p,
      hand: p.id === playerId ? p.hand : new Array(p.hand.length).fill({ hidden: true })
    }))
  };
}

function emitState() {
  if (!hostState?.gameState) return;
  const summary = hostState.players.map((p) => ({
    id: p.id,
    name: p.name,
    seat: p.seat,
    connected: p.connected
  }));

  for (const p of hostState.players) {
    const view = buildViewForPlayer(p.id);
    if (!view) continue;
    send(p.socket, {
      type: 'state',
      payload: {
        role: p.isHost ? 'host' : 'client',
        localPlayerId: p.id,
        localSeat: p.seat,
        players: summary,
        gameState: view
      }
    });
  }

  if (role === 'host') {
    uiState.gameState = buildViewForPlayer(localPlayerId);
    uiState.playerOrder = summary;
    renderAll();
  }
}

function seatOrderFromBottom(mySeat) {
  const order = ['bottom', 'left', 'top', 'right'];
  const idx = order.indexOf(mySeat);
  return [...order.slice(idx), ...order.slice(0, idx)];
}

function virtualSeat(realSeat, localSeatValue) {
  if (!localSeatValue) return realSeat;
  const global = ['bottom', 'left', 'top', 'right'];
  const localIdx = global.indexOf(localSeatValue);
  const realIdx = global.indexOf(realSeat);
  const mapped = (realIdx - localIdx + 4) % 4;
  return global[mapped];
}

function renderSlots() {
  const game = uiState.gameState;
  const players = game?.players || [];

  for (const slotKey of Object.keys(slots)) {
    slots[slotKey].classList.remove('turn-glow');
    slots[slotKey].innerHTML = '<span class="player-meta">Posto libero</span>';
  }

  for (const p of players) {
    const vSeat = virtualSeat(p.seat, localSeat);
    const active = game.currentTurnPlayerId === p.id;
    slots[vSeat].innerHTML = `
      <div class="player-name">${p.name}${p.id === localPlayerId ? ' (Tu)' : ''}</div>
      <div class="player-meta">Punti torneo: ${Number(p.tournamentPoints.toFixed(2))}</div>
      <div class="player-meta">Carte in mano: ${p.hand.length}</div>
      <div class="player-meta">${p.connected ? 'Connesso' : 'Disconnesso'}</div>
    `;
    if (active) slots[vSeat].classList.add('turn-glow');
  }
}

function renderTrick() {
  trickCardsEl.innerHTML = '';
  const game = uiState.gameState;
  if (!game) return;

  for (const t of game.trickCards) {
    const cardEl = document.createElement('div');
    cardEl.className = 'trick-card';
    cardEl.style.backgroundImage = `url("${cardToImage(t.card)}")`;
    cardEl.title = `${t.playerName}: ${t.card.suit} ${t.card.rank}`;
    trickCardsEl.appendChild(cardEl);
  }
}

function canPlayCardLocally(card) {
  const game = uiState.gameState;
  if (!game) return false;
  if (game.currentTurnPlayerId !== localPlayerId) return false;
  if (!card || card.hidden) return false;

  if (!game.currentTrickSuit) return true;
  const me = game.players.find((p) => p.id === localPlayerId);
  if (!me) return false;
  const hasSuit = me.hand.some((c) => !c.hidden && c.suit === game.currentTrickSuit);
  if (!hasSuit) return true;
  return card.suit === game.currentTrickSuit;
}

function renderHand() {
  handEl.innerHTML = '';
  const game = uiState.gameState;
  if (!game) return;

  const me = game.players.find((p) => p.id === localPlayerId);
  if (!me) return;

  for (let i = 0; i < me.hand.length; i++) {
    const card = me.hand[i];
    const cardEl = document.createElement('div');
    cardEl.className = 'hand-card';

    if (!card.hidden) {
      cardEl.style.backgroundImage = `url("${cardToImage(card)}")`;
      const legal = canPlayCardLocally(card);
      if (!legal) cardEl.classList.add('disabled');
      cardEl.addEventListener('click', () => {
        if (!legal) {
          addLog('Mossa non valida: devi rispondere al seme se puoi.', 'warn');
          return;
        }
        if (role === 'host') {
          hostPlayCard(localPlayerId, i);
        } else {
          send(wsClient, { type: 'play_card', payload: { handIndex: i } });
        }
      });
    } else {
      cardEl.classList.add('disabled');
    }

    handEl.appendChild(cardEl);
  }
}

function renderIndicators() {
  const game = uiState.gameState;
  if (!game) {
    turnIndicator.textContent = 'Nessun turno attivo';
    trickIndicator.textContent = 'Mano 0/10';
    return;
  }

  const active = game.players.find((p) => p.id === game.currentTurnPlayerId);
  turnIndicator.textContent = active ? `Turno: ${active.name}` : 'Turno: -';
  trickIndicator.textContent = `Mano ${game.trickNumber}/10`;
}

function renderLeaderboard() {
  const game = uiState.gameState;
  const players = game?.players || [];
  const sorted = [...players].sort((a, b) => a.tournamentPoints - b.tournamentPoints);

  leaderboardEl.innerHTML = sorted
    .map((p, idx) => `
      <div class="lb-row ${idx === 0 && game?.tournamentEnded ? 'winner' : ''}">
        <span>#${idx + 1} ${p.name}</span>
        <strong>${Number(p.tournamentPoints.toFixed(2))} pt</strong>
      </div>
    `)
    .join('');
}

function renderLobbySummary() {
  const count = uiState.playerOrder.length;
  const names = uiState.playerOrder.map((p) => `${p.name} (${p.seat})`).join(', ');
  lobbyStatus.textContent = count
    ? `Lobby: ${count}/4 giocatori - ${names}`
    : 'In attesa di una lobby...';

  if (role === 'host') {
    const canStart = count === MAX_PLAYERS && hostState && !hostState.gameState?.matchRunning;
    startMatchBtn.classList.toggle('hidden', !canStart);
  }
}

function renderAll() {
  renderSlots();
  renderTrick();
  renderHand();
  renderIndicators();
  renderLeaderboard();
  renderLobbySummary();
}

function createInitialGameState() {
  const players = hostState.players.map((p) => ({
    id: p.id,
    name: p.name,
    seat: p.seat,
    connected: p.connected,
    hand: [],
    tournamentPoints: p.tournamentPoints || 0,
    roundPoints: 0
  }));

  return {
    matchRunning: true,
    tournamentEnded: false,
    pointLimit: Number(pointLimitInput.value) || 41,
    players,
    deck: [],
    currentTurnPlayerId: null,
    leadPlayerId: null,
    currentTrickSuit: null,
    trickCards: [],
    trickNumber: 1,
    roundHistory: [],
    leaderboardHistory: []
  };
}

function chooseDealerOrder(players) {
  const ids = players.map((p) => p.id);
  const start = Math.floor(Math.random() * ids.length);
  return [...ids.slice(start), ...ids.slice(0, start)];
}

function dealNewRound(state) {
  const deck = shuffle(createDeck());
  for (const p of state.players) p.hand = [];

  for (let i = 0; i < 10; i++) {
    for (const p of state.players) {
      p.hand.push(deck.pop());
    }
  }

  for (const p of state.players) p.hand = sortHand(p.hand);

  if (!state.leadPlayerId) {
    const order = chooseDealerOrder(state.players);
    state.leadPlayerId = order[0];
  }
  state.currentTurnPlayerId = state.leadPlayerId;
  state.currentTrickSuit = null;
  state.trickCards = [];
  state.trickNumber = 1;
  state.roundPoints = 0;
  for (const p of state.players) p.roundPoints = 0;
}

function getPlayerIndex(state, id) {
  return state.players.findIndex((p) => p.id === id);
}

function nextPlayerId(state, currentId) {
  const idx = getPlayerIndex(state, currentId);
  return state.players[(idx + 1) % state.players.length].id;
}

function isValidPlay(state, playerId, handIndex) {
  if (state.currentTurnPlayerId !== playerId) return { ok: false, reason: 'Non è il tuo turno.' };
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { ok: false, reason: 'Giocatore non trovato.' };
  if (handIndex < 0 || handIndex >= player.hand.length) return { ok: false, reason: 'Carta non valida.' };

  const card = player.hand[handIndex];
  if (!state.currentTrickSuit) return { ok: true, card };

  const hasSuit = player.hand.some((c) => c.suit === state.currentTrickSuit);
  if (hasSuit && card.suit !== state.currentTrickSuit) {
    return { ok: false, reason: 'Devi rispondere al seme.' };
  }

  return { ok: true, card };
}

function trickWinner(state) {
  const leadSuit = state.currentTrickSuit;
  let winner = state.trickCards[0];

  for (const played of state.trickCards) {
    if (played.card.suit !== leadSuit) continue;
    if (compareCards(played.card, winner.card) > 0) winner = played;
  }

  return winner;
}

function concludeTrick(state) {
  const winner = trickWinner(state);
  const points = state.trickCards.reduce((acc, t) => acc + getPoints(t.card), 0);
  const winnerPlayer = state.players.find((p) => p.id === winner.playerId);
  if (winnerPlayer) winnerPlayer.roundPoints += points;

  addLog(`Presa a ${winner.playerName}: +${Number(points.toFixed(2))} punti`, 'good');

  state.leadPlayerId = winner.playerId;
  state.currentTurnPlayerId = winner.playerId;
  state.currentTrickSuit = null;
  state.trickCards = [];
  state.trickNumber += 1;
}

function concludeRound(state) {
  state.roundHistory.push({
    at: Date.now(),
    results: state.players.map((p) => ({ name: p.name, roundPoints: Number(p.roundPoints.toFixed(2)) }))
  });

  for (const p of state.players) {
    p.tournamentPoints += p.roundPoints;
    p.roundPoints = 0;
  }

  state.leaderboardHistory = [...state.players]
    .sort((a, b) => a.tournamentPoints - b.tournamentPoints)
    .map((p) => ({ id: p.id, name: p.name, points: Number(p.tournamentPoints.toFixed(2)) }));

  const reached = state.players.some((p) => p.tournamentPoints >= state.pointLimit);
  if (reached) {
    state.tournamentEnded = true;
    state.matchRunning = false;
    const ordered = [...state.players].sort((a, b) => a.tournamentPoints - b.tournamentPoints);
    addLog(`Torneo finito! Vince ${ordered[0].name} con ${Number(ordered[0].tournamentPoints.toFixed(2))} punti.`, 'good');
    return;
  }

  dealNewRound(state);
  addLog('Nuova manche distribuita.', 'good');
}

function hostPlayCard(playerId, handIndex) {
  if (!hostState?.gameState?.matchRunning) return;
  const state = hostState.gameState;
  const check = isValidPlay(state, playerId, handIndex);

  if (!check.ok) {
    const p = hostState.players.find((x) => x.id === playerId);
    if (p?.socket) send(p.socket, { type: 'error_msg', payload: check.reason });
    if (playerId === localPlayerId) addLog(check.reason, 'warn');
    return;
  }

  const player = state.players.find((p) => p.id === playerId);
  const card = player.hand.splice(handIndex, 1)[0];

  if (!state.currentTrickSuit) state.currentTrickSuit = card.suit;
  state.trickCards.push({
    playerId,
    playerName: player.name,
    card
  });

  if (state.trickCards.length < MAX_PLAYERS) {
    state.currentTurnPlayerId = nextPlayerId(state, playerId);
  } else {
    concludeTrick(state);
    const remaining = state.players[0].hand.length;
    if (remaining === 0) concludeRound(state);
  }

  emitState();
}

function startHostedMatch() {
  if (!hostState || hostState.players.length !== MAX_PLAYERS) {
    addLog('Servono 4 giocatori per iniziare.', 'warn');
    return;
  }

  hostState.gameState = createInitialGameState();
  dealNewRound(hostState.gameState);
  addLog('Partita avviata. Buon divertimento!', 'good');
  emitState();
}

function createHostPlayer(name) {
  const id = `p_${Math.random().toString(36).slice(2, 10)}`;
  return {
    id,
    name,
    seat: 'bottom',
    socket: null,
    connected: true,
    isHost: true,
    tournamentPoints: 0
  };
}

function assignSeat(players) {
  const seats = ['bottom', 'left', 'top', 'right'];
  for (const seat of seats) {
    if (!players.some((p) => p.seat === seat)) return seat;
  }
  return null;
}

function sendLobbySnapshot(targetWs = null) {
  if (!hostState) return;
  const players = hostState.players.map((p) => ({
    id: p.id,
    name: p.name,
    seat: p.seat,
    connected: p.connected
  }));

  const payload = { type: 'lobby', payload: { players, pointLimit: Number(pointLimitInput.value) || 41 } };

  if (targetWs) {
    send(targetWs, payload);
  } else {
    broadcast(payload);
    uiState.playerOrder = players;
    renderLobbySummary();
  }
}

function setupHost() {
  if (wss) {
    addLog('Host già attivo.', 'warn');
    return;
  }

  role = 'host';
  setStatus('Host attivo', '#14532d');

  const hostName = (playerNameInput.value || '').trim() || getDefaultName();
  const hostPlayer = createHostPlayer(hostName);
  localPlayerId = hostPlayer.id;
  localSeat = hostPlayer.seat;

  hostState = {
    players: [hostPlayer],
    gameState: null
  };

  wss = new WebSocketServer({ port: DEFAULT_PORT });
  const ip = getLocalIPv4();
  hostUrlEl.classList.remove('hidden');
  hostUrlEl.textContent = `Condividi URL: ws://${ip}:${DEFAULT_PORT}`;

  addLog('Server host avviato su porta 7070.', 'good');

  wss.on('connection', (ws) => {
    let joinedPlayerId = null;

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'join') {
          if (hostState.players.length >= MAX_PLAYERS) {
            send(ws, { type: 'error_msg', payload: 'Lobby piena.' });
            ws.close();
            return;
          }

          const seat = assignSeat(hostState.players);
          const id = `p_${Math.random().toString(36).slice(2, 10)}`;
          const player = {
            id,
            name: (msg.payload?.name || '').trim() || getDefaultName(),
            seat,
            socket: ws,
            connected: true,
            isHost: false,
            tournamentPoints: 0
          };
          joinedPlayerId = id;
          hostState.players.push(player);
          send(ws, { type: 'joined', payload: { playerId: id, seat } });
          addLog(`${player.name} si è unito al tavolo (${seat}).`, 'good');
          sendLobbySnapshot();
          emitState();
          return;
        }

        if (msg.type === 'play_card') {
          if (!joinedPlayerId) return;
          hostPlayCard(joinedPlayerId, Number(msg.payload?.handIndex));
          return;
        }

        if (msg.type === 'start_match') {
          if (joinedPlayerId) return;
          startHostedMatch();
        }
      } catch {
        send(ws, { type: 'error_msg', payload: 'Messaggio non valido.' });
      }
    });

    ws.on('close', () => {
      if (!joinedPlayerId || !hostState) return;
      const p = hostState.players.find((x) => x.id === joinedPlayerId);
      if (!p) return;
      p.connected = false;
      p.socket = null;
      addLog(`${p.name} disconnesso.`, 'warn');
      sendLobbySnapshot();
      emitState();
    });
  });

  uiState.playerOrder = hostState.players.map((p) => ({
    id: p.id,
    name: p.name,
    seat: p.seat,
    connected: p.connected
  }));

  renderAll();
}

function connectAsClient() {
  const url = (joinInput.value || '').trim();
  if (!url) {
    addLog('Inserisci URL host (ws://...).', 'warn');
    return;
  }

  role = 'client';
  wsClient = new WebSocket(url);

  wsClient.onopen = () => {
    const name = (playerNameInput.value || '').trim() || getDefaultName();
    send(wsClient, { type: 'join', payload: { name } });
    setStatus('Connesso al tavolo', '#0c4a6e');
    addLog('Connessione host riuscita.', 'good');
  };

  wsClient.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data.toString());

      if (msg.type === 'joined') {
        localPlayerId = msg.payload.playerId;
        localSeat = msg.payload.seat;
        addLog(`Sei seduto in posizione ${localSeat}.`, 'good');
        return;
      }

      if (msg.type === 'lobby') {
        uiState.playerOrder = msg.payload.players;
        pointLimitInput.value = msg.payload.pointLimit;
        renderLobbySummary();
        return;
      }

      if (msg.type === 'state') {
        localPlayerId = msg.payload.localPlayerId;
        localSeat = msg.payload.localSeat;
        uiState.playerOrder = msg.payload.players;
        uiState.gameState = msg.payload.gameState;
        renderAll();
        return;
      }

      if (msg.type === 'error_msg') {
        addLog(msg.payload, 'warn');
      }
    } catch {
      addLog('Messaggio server non valido.', 'warn');
    }
  };

  wsClient.onclose = () => {
    setStatus('Disconnesso', '#7f1d1d');
    addLog('Connessione al server chiusa.', 'warn');
  };

  wsClient.onerror = () => {
    setStatus('Errore connessione', '#7f1d1d');
    addLog('Errore di rete: controlla URL e porta aperta.', 'warn');
  };
}

hostBtn.addEventListener('click', setupHost);
joinBtn.addEventListener('click', connectAsClient);

startMatchBtn.addEventListener('click', () => {
  if (role !== 'host') return;
  startHostedMatch();
});

renderAll();
addLog('Pronto. Crea una lobby host o unisciti con URL remoto.');
