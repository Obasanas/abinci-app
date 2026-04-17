const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3001;

// Serve shared assets from parent directory
app.use('/assets', express.static(path.join(__dirname, '../assets')));

// Serve static files first — sw.js, manifest.json, icons must be served as-is
app.use(express.static(path.join(__dirname), {
  setHeaders: (res, filePath) => {
    // Service worker must have correct MIME type and no-cache
    if (filePath.endsWith('sw.js')) {
      res.setHeader('Content-Type', 'application/javascript');
      res.setHeader('Service-Worker-Allowed', '/');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
    // Manifest must have correct MIME type
    if (filePath.endsWith('manifest.json')) {
      res.setHeader('Content-Type', 'application/manifest+json');
    }
  }
}));

// SPA fallback — only for non-file routes
app.get('*', (req, res) => {
  // Don't intercept file requests
  if (req.path.includes('.')) return res.status(404).end();
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => console.log(`Customer app running on port ${PORT}`));
