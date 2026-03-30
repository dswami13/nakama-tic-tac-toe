# Server-Authoritative Multiplayer Tic-Tac-Toe

[cite_start]A production-ready, server-authoritative multiplayer Tic-Tac-Toe game built with a vanilla HTML/JS frontend and a Nakama backend[cite: 11]. 

## 🌐 Live Demo
**Play the game here:** `http://3.107.113.140`

## 🏗️ Architecture and Design Decisions
[cite_start]This project implements a server-authoritative game model to prevent client-side cheating and ensure state consistency[cite: 20, 21, 23].
* **Frontend:** Vanilla HTML, CSS, and JavaScript. Chosen for lightweight delivery and zero-build-step deployment. Communicates with the backend via WebSockets (`nakama-js`).
* **Backend:** Nakama (written in Go, game logic in TypeScript). [cite_start]Handles real-time socket connections, user authentication, and match state routing[cite: 24, 29].
* **Database:** CockroachDB. Used by Nakama to persist user accounts and server configurations.
* [cite_start]**Matchmaking:** Implemented Nakama's native matchmaker to pool players together [cite: 27][cite_start], alongside a custom RPC call to generate isolated, shareable private game rooms[cite: 26, 38].

## ⚙️ API and Server Configuration
[cite_start]The Nakama server exposes the following ports for communication[cite: 60]:
* `7350`: Main API and WebSocket port (Used by the frontend client).
* `7351`: Developer Console (Administrative access).
* `26257`: CockroachDB internal networking.
* `80`: Nginx Web Server (Serving the frontend).

## 🚀 Setup and Installation (Local Development)
[cite_start]To run this project locally via Docker[cite: 60]:
1. Clone the repository.
2. Ensure Docker and Docker Compose are installed.
3. Run `npm install` to grab the TypeScript dependencies for the backend module.
4. Run `npm run build` to compile the TypeScript game logic into `/build/main.js`.
5. Run `docker-compose up -d` to spin up Nakama and CockroachDB.
6. Open `index.html` in your browser. (Note: Change the IP in `client.js` back to `127.0.0.1` for local testing).

## ☁️ Deployment Process
[cite_start]The application is deployed on a single AWS EC2 `t3.micro` instance running Ubuntu 24.04 LTS to bypass browser Mixed Content (HTTP/HTTPS) restrictions[cite: 31, 60].
1. Provisioned an EC2 instance and configured security groups to allow inbound traffic on TCP ports `80`, `7350`, and `7351`.
2. Migrated the `docker-compose.yml`, `local.yml`, and compiled `build/` directory via SCP.
3. Booted the Nakama and CockroachDB containers via Docker Compose.
4. Migrated the frontend assets (`index.html`, `client.js`, etc.) via SCP to a `~/frontend` directory.
5. [cite_start]Deployed a Dockerized Nginx container (`docker run -d -p 80:80 -v $(pwd):/usr/share/nginx/html nginx`) to serve the static frontend assets on port 80[cite: 32].

## 🎮 How to Test Multiplayer Functionality
[cite_start]To test the core multiplayer loop[cite: 61]:
1. Open the [Live Demo](http://3.107.113.140) in two separate browser windows (or on two different devices).
2. Enter a unique nickname in each window and click **Continue**.
3. [cite_start]**Quick Play:** Click "Find Match" in both windows to test the automated matchmaker[cite: 27].
4. **Custom Room:** In Window A, click "Create Match". [cite_start]In Window B, click "Refresh List" and click "Join Room" next to the newly created match ID[cite: 26, 28].
5. Play the game! The server validates all moves and broadcasts the board state. Upon winning, losing, or drawing, the game will present a "Play Again" button to restart the loop.