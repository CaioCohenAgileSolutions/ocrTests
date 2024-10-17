const ocrService = require('../services/ocrService');
const path = require('path');
const sharp = require('sharp');
const fs = require('fs');

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

exports.splitImage = async (req, res) => {
  try {
    // Verifica se o arquivo foi enviado
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhuma imagem enviada' });
    }

    const imagePath = path.resolve(req.file.path);
    let outputDir = path.resolve('uploads/ids'); // Diretório de saída para as imagens divididas

    // IDs

    // Certifique-se de que o diretório de saída existe
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Parâmetros para o corte da imagem (ajuste conforme necessário)
    let width = 2050;
    let height = 1330;
    let rows = 5;
    let cols = 4;

    // Remove as bordas da imagem original e prepara para divisão
    const trimmedImagePath = path.join(outputDir, `trimmed_${req.file.originalname.split('.')[0]}.jpg`);
    await sharp(imagePath)
      .extract({ left: 100, top: 170, width, height })
      .toFile(trimmedImagePath);

    // Array para armazenar os caminhos das imagens geradas
    const splitImagePathsIds = [];

    // Divide a imagem em 20 partes (5 linhas x 4 colunas)
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const left = Math.floor(col * (width / cols)) + 220 - (col * 5);
        const top = Math.floor(row * (height / rows)) + 95 - (row * 4);
        const partWidth = Math.floor((width / cols)/3);
        const partHeight = Math.floor((height / rows)/10.5);

        const outputPath = path.join(outputDir, `part_${row}_${col}_${req.file.originalname.split('.')[0]}.jpg`);

        await sharp(trimmedImagePath)
          .extract({ left, top, width: partWidth, height: partHeight })
          .toFile(outputPath);

          splitImagePathsIds.push(outputPath);
      }
    }

    //VOTES

    outputDir = path.resolve('uploads/votes'); 

    // Certifique-se de que o diretório de saída existe
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Parâmetros para o corte da imagem (ajuste conforme necessário)
    width = 2050;
    height = 1330;
    rows = 5;
    cols = 4;

    // Array para armazenar os caminhos das imagens geradas
    const splitImagePathsVotes = [];

    // Divide a imagem em 20 partes (5 linhas x 4 colunas)
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const left = Math.floor(col * (width / cols)) + 130 - (col * 5);
        const top = Math.floor(row * (height / rows)) + 115 - (row * 4);
        const partWidth = Math.floor((width / cols)*0.70);
        const partHeight = Math.floor((height / rows)/2);

        const outputPath = path.join(outputDir, `part_${row}_${col}_${req.file.originalname.split('.')[0]}.jpg`);

        await sharp(trimmedImagePath)
          .extract({ left, top, width: partWidth, height: partHeight })
          .toFile(outputPath);

          splitImagePathsVotes.push(outputPath);
      }
    }

    // Retorna os caminhos das imagens geradas
    res.json({ message: 'Imagem dividida com sucesso', parts: splitImagePathsIds });
  } catch (error) {
    console.error('Erro ao dividir a imagem:', error);
    res.status(500).json({ error: 'Erro ao dividir a imagem' });
  }
};

