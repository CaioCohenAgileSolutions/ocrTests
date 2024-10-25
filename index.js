const express = require('express');
const cors = require('cors'); // Importar o middleware cors


const app = express();
// Habilitar CORS para todas as rotas
app.use(cors());
const port = 3300;
const ocrRoutes = require('./routes/ocrRoutes');

app.use(express.json({ limit: '50mb' })); // Define o limite para 50 MB
app.use(express.urlencoded({ limit: '50mb', extended: true })); // Define o limite para dados url-encoded


// Middleware para parsear JSON
app.use(express.json());

// Rotas
app.use('/api/ocr', ocrRoutes);

// Iniciando o servidor
app.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
});
