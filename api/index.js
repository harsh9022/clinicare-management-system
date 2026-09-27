// Vercel entry point. Vercel calls this file as a serverless function for
// every request matched to it by vercel.json's routes. We reuse the exact
// same Express app that runs locally / on Render / in Docker — server.js
// exports it via `module.exports = app` and only calls app.listen() when
// run directly, so importing it here is safe.
module.exports = require("../server/server.js");
