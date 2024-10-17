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

    // Chama o serviço para contar os pixels
    const result = await ocrService.checkVoted(imagePath);

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
    const filename = req.file.originalname.split('.')[0].replace(/[^a-zA-Z0-9]/g, '');
    const trimmedImagePath = path.join(outputDir, `trimmed_${filename}.jpg`);

    // Verifica se o arquivo já existe e o remove se necessário
    if (fs.existsSync(trimmedImagePath)) {
      fs.unlinkSync(trimmedImagePath); // Remove o arquivo existente
    }

    await sharp(imagePath)
      .extract({ left: 100, top: 170, width, height })
      .toFile(trimmedImagePath);

    // Array para armazenar os caminhos das imagens geradas
    const splitImagePathsIds = [];
    let result = [];

    // Divide a imagem em 20 partes (5 linhas x 4 colunas)
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const left = Math.floor(col * (width / cols)) + 220 - (col * 5);
        const top = Math.floor(row * (height / rows)) + 95 - (row * 4);
        const partWidth = Math.floor((width / cols) / 3);
        const partHeight = Math.floor((height / rows) / 10.5);

        const outputPath = path.join(outputDir, `part_${row}_${col}_${filename}.jpg`);

        await sharp(trimmedImagePath)
          .extract({ left, top, width: partWidth, height: partHeight })
          // .threshold(32) 
          // .blur(1)
          .toFile(outputPath);

        // const { data, info } = await sharp(outputPath).raw().toBuffer({ resolveWithObject: true });

        // // Itera sobre cada pixel da imagem
        // const newData = Buffer.from(data); // Cria uma cópia do buffer de dados
        // const tolerance = 10; // Tolerância para comparação de cores (pode ajustar conforme necessário)
        // const stampColor = { r: 0, g: 0, b: 0 };

        // for (let i = 0; i < data.length; i += 3) {
        //   const red = data[i];
        //   const green = data[i + 1];
        //   const blue = data[i + 2];

        //   // Verifica se o pixel corresponde à cor do carimbo (dentro de uma tolerância)
        //   if (
        //     Math.abs(red - stampColor.r) <= tolerance &&
        //     Math.abs(green - stampColor.g) <= tolerance &&
        //     Math.abs(blue - stampColor.b) <= tolerance
        //   ) {
        //     // Substitui o pixel pela cor branca (255, 255, 255)
        //     newData[i] = 255;   // R
        //     newData[i + 1] = 255; // G
        //     newData[i + 2] = 255; // B
        //   }
        // }

        // // Converte o buffer de volta para uma imagem e salva no caminho de saída
        // await sharp(newData, { raw: { width: info.width, height: info.height, channels: 3 } })
        //   .toFile(outputPath);

        // Realiza o OCR na parte da imagem e obtém o ID
        //const idLido = await ocrService.readImage(outputPath, 'image/jpeg');
        const idLido = await ocrService.readImageWithAI(outputPath);
        result.push({
          id: idLido,
          votou: null
        })

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
    let i = 0;
    // Divide a imagem em 20 partes (5 linhas x 4 colunas)
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const left = Math.floor(col * (width / cols)) + 130 - (col * 5);
        const top = Math.floor(row * (height / rows)) + 115 - (row * 4);
        const partWidth = Math.floor((width / cols) * 0.70);
        const partHeight = Math.floor((height / rows) / 2);

        const outputPath = path.join(outputDir, `part_${row}_${col}_${filename}.jpg`);

        await sharp(trimmedImagePath)
          .extract({ left, top, width: partWidth, height: partHeight })
          .toFile(outputPath);

        // Realiza o OCR na parte da imagem e obtém o ID
        const votou = await ocrService.checkVoted(outputPath);
        result[i].votou = votou.votou;
        i++;

        splitImagePathsVotes.push(outputPath);
      }
    }

    res.json(result);
  } catch (error) {
    console.error('Erro ao dividir a imagem:', error);
    res.status(500).json({ error: 'Erro ao dividir a imagem' });
  }
};

