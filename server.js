const express = require('express');
const path = require('path');
const app = express();
const port = 5001;

app.use('/excalidraw-app', express.static(path.join(__dirname, 'build')));

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}/excalidraw-app`);
});
