const express = require('express');
const app = express();
const port = 3000;
const ocrRoutes = require('./routes/ocrRoutes');

// Middleware para parsear JSON
app.use(express.json());

// Rotas
app.use('/api/ocr', ocrRoutes);

// Iniciando o servidor
app.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
});
