const ocrService = require('../services/ocrService');
const path = require('path');

exports.processImage = async (req, res) => {
  try {
    // Verifica se o arquivo foi enviado
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }

    // Caminho completo do arquivo salvo
    const imagePath = path.resolve(req.file.path);

    // Chama o serviço de OCR passando o caminho da imagem
    const ocrResult = await ocrService.readImage(imagePath, req.file.mimetype);

    // Retorna o resultado do OCR
    res.json({ extractedNumbers: ocrResult });
  } catch (error) {
    console.error('Erro ao processar a imagem:', error);
    res.status(500).json({ error: 'Erro ao processar a imagem' });
  }
};

exports.checkVoted = async (req, res) => {
  try {
    // Verifica se o arquivo foi enviado
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhuma imagem enviada' });
    }

    // Obtém o caminho completo do arquivo salvo
    const imagePath = path.resolve(req.file.path);

    // Define a cor alvo em formato RGB (ajuste conforme necessário)
    const targetColor = { r: 84, g: 83, b: 96 }; // Exemplo: vermelho puro

    // Chama o serviço para contar os pixels
    const result = await ocrService.checkVoted(imagePath, targetColor);

    // Retorna o resultado
    res.json(result);
  } catch (error) {
    console.error('Erro ao processar a imagem:', error);
    res.status(500).json({ error: 'Erro ao processar a imagem' });
  }
};

