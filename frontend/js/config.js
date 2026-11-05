// Where the CivicPulse backend (API) is running.
//
// - Opened through the backend (npm start -> http://localhost:5000): the backend replaces this file
//   with an empty address, so the pages talk to the same server.
// - Opened through VS Code "Live Server" (http://127.0.0.1:5500) or another static server: the pages
//   call the backend at the address below. Keep the backend running in a terminal (npm start).
//
// If you change PORT in backend/.env, change the port here too.
window.CIVICPULSE_API = 'http://localhost:5000';
