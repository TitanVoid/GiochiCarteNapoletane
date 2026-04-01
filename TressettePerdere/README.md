# Tresette a Perdere (Electron Multiplayer)

Prototipo completo per giocare in 4 online con regole ufficiali di Tresette a Perdere.

## Funzionalità

- Tavolo multiplayer host/client tramite WebSocket (`ws://IP:7070`)
- Avvio solo con **4 giocatori**
- Regole ufficiali prese (obbligo seme + ordine carte)
- Punteggio carte ufficiale con **Asso di Bastoni = 11** (Asso Bastardo)
- Torneo a limite punti configurabile
- Fine torneo: quando il primo raggiunge il limite, vince chi ha meno punti
- Leaderboard e log eventi in tempo reale
- UI moderna con animazioni carte e stato turni

## Avvio locale

```bash
npm install
npm start
```

## Come ospitare una partita per amici su altre reti

1. L'host clicca **Crea tavolo (Host)**.
2. Apri/forwarda sul router la porta TCP **7070** verso il PC host.
3. Comunica agli amici l'URL: `ws://TUO_IP_PUBBLICO:7070`.
4. Gli amici inseriscono l'URL e cliccano **Unisciti**.
5. A 4 giocatori, l'host clicca **Avvia partita (4/4)**.

## Regole implementate

- Mazzo napoletano da 40 carte (10 per giocatore)
- Ordine forza presa: **3 > 2 > Asso > Re > Cavallo > Fante > 7 > 6 > 5 > 4**
- Obbligo di rispondere al seme
- Valori punti carta:
  - Asso = 1
  - 2, 3, Re, Cavallo, Fante = 1/3
  - 7,6,5,4 = 0
  - **Asso di Bastoni = 11**

## Note

- Ogni client avvia la propria app Electron e si connette all'host via URL WebSocket.
- Se un player si disconnette, appare come disconnesso in lobby/stato.
