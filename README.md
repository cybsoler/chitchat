# Relay

Relay is a browser-based group chat. Create an account, make a room, and share its
six-character code. Friends can join from any device without installing an app.

## Run

```powershell
node server.js
```

Open `http://localhost:3000`.

The app uses only Node.js built-in modules. User accounts, rooms, and messages are
stored in `data/store.json`.

## Message privacy behavior

Messages from other people stay available, including messages sent while you were
offline. When you leave a room, your messages from that visit are hidden from you
the next time you open the room. Other participants still retain their copy.
