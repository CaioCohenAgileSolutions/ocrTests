const express = require('express');
const multer = require('multer');
const ocrController = require('../controllers/ocrController');

const router = express.Router();
const upload = multer({ dest: 'uploads/' }); // Pasta onde os arquivos serão armazenados temporariamente

// Rota POST para enviar uma imagem
router.post('/upload', upload.single('image'), ocrController.processImage);

module.exports = router;