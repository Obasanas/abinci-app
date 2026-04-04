const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.static(path.join(__dirname)));

// Landing page at root
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'landing.html')));

// Share page
app.get('/share', (req, res) => res.sendFile(path.join(__dirname, 'share.html')));

// Catch-all
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'landing.html')));

app.listen(PORT, () => console.log(`abinci.food running on port ${PORT}`));
