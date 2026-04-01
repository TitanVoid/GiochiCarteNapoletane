const hand = document.getElementById("player-hand");
const center = document.getElementById("center-table");
const newGameBtn = document.getElementById("new-game-btn");

const suits = ["bastoni", "coppe", "oro", "spade"];
const ranks = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
const values = [1, 1/3, 1/3, 0, 0, 0, 0, 1/3, 1/3, 1/3];
const weights = [8, 9, 10, 1, 2, 3, 4, 5, 6, 7]

let deck = [];
let players = {
  bottom: [],
  left: [],
  top: [],
  right: []
};

let playerPoints = {
  bottom: 0,
  left: 0,
  top: 0,
  right: 0
}

// Create random start order for players
let turnOrder = ["bottom", "left", "top", "right"];
let currentTurn = 0;
// Suit that started the current trick (mano). Null when no card led yet.
let trickSuit = null;
let playedThisRound = [];

// Creates the full deck of cards
function createDeck() {
  deck = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push(`${suit}#${rank}`);
    }
  }
}

// Shuffle the deck using Fisher-Yates algorithm
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

// Deal cards to players
function dealCards() {
  createDeck();
  shuffle(deck);
  players.bottom = deck.splice(0, 10);
  players.left = deck.splice(0, 10);
  players.top = deck.splice(0, 10);
  players.right = deck.splice(0, 10);
}

// Sort cards in each player's hand by suit and rank
function sortCards() {
  turnOrder.forEach(player => {
    let playerCards = players[player];
    playerCards.sort((a, b) => {
      let [suitA, rankA] = a.split("#");
      let [suitB, rankB] = b.split("#");
      if (suitA !== suitB) {
        return suits.indexOf(suitA) - suits.indexOf(suitB);
      }
      return ranks.indexOf(rankA) - ranks.indexOf(rankB);
    });
  });
}

function renderHand() {
  hand.innerHTML = "";
  players.bottom.forEach((card, index) => {
    const cardEl = document.createElement("div");
    cardEl.classList.add("card");
    let currentCard = card.split("#");
    cardEl.style.backgroundImage = `url("carte/${currentCard[0]}/${currentCard[0]}_${currentCard[1]}.jpg")` //load image
    cardEl.style.backgroundSize = "cover";
    cardEl.addEventListener("click", () => {
      if (turnOrder[currentTurn] === "bottom") {
        playCard("bottom", index);
      }
    });
    hand.appendChild(cardEl);
  });

}

function renderCenter() {
  center.innerHTML = "";
  playedThisRound.forEach(({ player, card }) => {
    const cardEl = document.createElement("div");
    cardEl.classList.add("card");
    let currentCard = card.split("#");
    cardEl.style.backgroundImage = `url("carte/${currentCard[0]}/${currentCard[0]}_${currentCard[1]}.jpg")` //load image
    cardEl.style.backgroundSize = "cover";
    center.appendChild(cardEl);
  });
}

function playCard(player, cardIndex = null) {
  const handArr = players[player];
  // default to 0 if not provided (bots previously used null)
  if (cardIndex === null || cardIndex === undefined) cardIndex = 0;

  // Peek the intended card without removing yet
  const card = handArr[cardIndex];
  const currentCard = card.split("#");
  const cardSuit = currentCard[0];

  // Enforce follow-suit rule for the human player
  if (player === "bottom" && playedThisRound.length > 0 && trickSuit) {
    const hasLedSuit = handArr.some(c => c.split("#")[0] === trickSuit);
    if (cardSuit !== trickSuit && hasLedSuit) {
      // Illegal move: must follow suit if possible
      // Optionally provide UI feedback; for now, just ignore the click
      return;
    }
  }

  // Now actually remove the chosen card
  handArr.splice(cardIndex, 1);
  renderHand();

  playedThisRound.push({ player, card });
  // If it's the first card of the trick, set the led suit
  if (!trickSuit) {
    trickSuit = cardSuit;
  }
  renderCenter();

  nextTurn();
}

function nextTurn() {
  currentTurn++;
  if (currentTurn >= turnOrder.length) {
    // Fine mano
    setTimeout(() => {
      renderCenter();
      endTurn();
      playedThisRound = [];
      currentTurn = 0;
      if (players.bottom.length === 0) {
        alert("Partita terminata");
        endTournament();
      }
      playTurn();
    }, 1500);
  } else {
    playTurn();
  }
}

function playTurn() {
  const player = turnOrder[currentTurn];
  if (player === "bottom") {
    // Attesa input utente
  } else {
    // Bot: follow suit if possible, otherwise play any (first) card
    const handArr = players[player];
    let idx = 0;
    if (playedThisRound.length > 0 && trickSuit) {
      const followIdx = handArr.findIndex(c => c.split("#")[0] === trickSuit);
      if (followIdx !== -1) idx = followIdx;
    }
    setTimeout(() => playCard(player, idx), 800);
  }
}

function endTurn() {
  let startSuit = playedThisRound[0].card.split("#")[0];
  let currentWinner = playedThisRound[0];
  let turnValue = 0;
  playedThisRound.forEach(({ player, card }) => {
    let currentCard = card.split("#");
    if (currentCard[0] === startSuit) {
      // Il giocatore ha giocato una carta dello stesso seme
      // Logica per calcolare il punteggio o altre azioni

      // Controlla se la carta corrente vince rispetto alla carta del vincitore attuale
      if (weights[parseInt(currentWinner.card.split("#")[1]) - 1] < weights[parseInt(currentCard[1]) - 1]){
        // Aggiorna il vincitore attuale
        currentWinner = { player, card };
      }
    } else {
      // Il giocatore ha giocato una carta di un seme diverso
      // Logica per calcolare il punteggio o altre azioni
    }

    // Aggiungi il valore della carta al punteggio del turno
    if (card === "bastoni#1") turnValue += 10; // Aggiungi 10 punti per le carte di bastoni => porta il valore dell'asso di bastoni a 11
    console.log(`Carta giocata da ${player}: ${card} Valore: ${values[parseInt(currentCard[1]) - 1]}`);
    turnValue += values[parseInt(currentCard[1]) - 1];
    console.log(`Punteggio del turno attuale: ${turnValue}`);
  });
  
  playerPoints[currentWinner.player] += turnValue;
  alert(`${currentWinner.player} ha vinto la mano con ${turnValue} punti!`);
  // Reset trick state
  trickSuit = null;
}

function startGame() {
  dealCards();
  sortCards();
  currentTurn = 0;
  playedThisRound = [];
  renderHand();
  renderCenter();
  playTurn();
}

function endTournament() {
  for (const player in playerPoints) {
    console.log(`${player} ha totalizzato ${playerPoints[player]} punti!`);
  }
}

newGameBtn.addEventListener("click", startGame);