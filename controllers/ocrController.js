const ocrService = require('../services/ocrService');
const path = require('path');
const sharp = require('sharp');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

async function combineImagesVertically(imageParts, outputCombinedPath) {
  try {
    // Lê os buffers de todas as partes das imagens
    const images = await Promise.all(imageParts.map(part => sharp(part).toBuffer()));

    // Obtém os metadados da primeira imagem (assumindo que todas têm a mesma largura)
    const { width } = await sharp(images[0]).metadata();

    // Calcula a altura total da nova imagem (somatório das alturas de todas as partes)
    const totalHeight = await images.reduce(async (sum, imgBuffer) => {
      const { height } = await sharp(imgBuffer).metadata();
      return (await sum) + height;
    }, 0);

    // Cria uma nova imagem combinada com a altura total e a largura das partes
    let compositeOptions = [];
    let currentHeight = 0;

    // Monta as opções para o composite
    for (let imgBuffer of images) {
      const { height } = await sharp(imgBuffer).metadata();
      compositeOptions.push({ input: imgBuffer, top: currentHeight, left: 0 });
      currentHeight += height;
    }

    // Cria uma imagem base (branca) e faz o composite com todas as partes de uma só vez
    await sharp({
      create: {
        width: width,
        height: totalHeight,
        channels: 3,
        background: { r: 255, g: 255, b: 255 }, // Cor de fundo branca
      },
    })
      .composite(compositeOptions) // Aplica o composite de todas as imagens
      .toFile(outputCombinedPath); // Salva a imagem combinada

    console.log('Imagem combinada salva:', outputCombinedPath);
  } catch (error) {
    console.error('Erro ao combinar as imagens:', error);
  }
}

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

exports.splitImage = async (req, res) => {
  try {
    const tempDir = './tmp';
    if (!req.body.base64Image) {
      return res.status(400).json({ error: 'Nenhuma imagem em Base64 enviada' });
    }

    const base64Image = req.body.base64Image;
    const buffer = Buffer.from(base64Image, 'base64');

    let outputDir = path.resolve('uploads/ids'); // Diretório de saída para as imagens divididas

    // IDs

    // Certifique-se de que o diretório de saída existe
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Define o caminho do arquivo temporário para armazenar a imagem convertida de Base64
    const filename = `temp_image_${uuidv4()}`;
    const imagePath = path.join(outputDir, filename+ '.jpg');

    // Escreve o buffer (imagem convertida de Base64) para um arquivo temporário
    fs.writeFileSync(imagePath, buffer);
    // First, remove the borders
    const cuttedImagePath = await ocrService.cutImageBorders(imagePath);
    const resizedImagePath = await ocrService.resizeImage(cuttedImagePath);
    const cuttedResizedImagePath = await ocrService.cutResizedBorders(resizedImagePath);

    const { width, height } = await sharp(cuttedResizedImagePath).metadata();

    const rows = 5;
    const cols = 4;
    const result = [];

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const cellWidth = Math.ceil(width / cols);
        const cellHeight = Math.ceil(height / rows);
        const cellLeft = col * cellWidth;
        const cellTop = row * cellHeight;

        if (cellWidth > 0 && cellHeight > 0) {

          //Titulo
          const titlePath = path.join(tempDir, `title${filename}.jpg`);
          const titleDirectory = path.dirname(titlePath);

          if (!fs.existsSync(titleDirectory)) {
            fs.mkdirSync(titleDirectory, { recursive: true });
          }
          await sharp(resizedImagePath)
            .extract({
              left: 400,
              top: 20,
              width: 1270,
              height: 110
            })
            .toFile(titlePath);

          //Celulas
          const cellPath = path.join(tempDir, `cell_${row}_${col}_${filename}.jpg`);
          await sharp(cuttedResizedImagePath)
            .extract({
              left: cellLeft,
              top: cellTop,
              width: Math.min(cellWidth, width - cellLeft),
              height: Math.min(cellHeight, height - cellTop)
            })
            .toFile(cellPath);

          //numero
          const numberPath = path.join(tempDir, `num_${row}_${col}_${filename}.jpg`);
          await sharp(cellPath)
            .metadata()
            .then(metadata => {
              const errorMargin = 0.05;
              const infoLeft = 10;
              const infoTop = 142;
              const infoWidth = 130;
              const infoHeight = 90;
              return sharp(cellPath)
                .extract({
                  left: infoLeft,
                  top: infoTop,
                  width: Math.min(infoWidth, metadata.width - infoLeft),
                  height: Math.min(infoHeight, metadata.height - infoTop)
                })
                .toFile(numberPath);
            });

          //as Info
          const infoPath = path.join(tempDir, `info_${row}_${col}_${filename}.jpg`);
          await sharp(cellPath)
            .metadata()
            .then(metadata => {
              const errorMargin = 0.05;
              const infoLeft = Math.floor(metadata.width * (1 / 4));
              const infoTop = Math.floor(metadata.height * (1 / 4) * (1 - errorMargin));
              const infoWidth = Math.floor(metadata.width * (3 / 4));
              const infoHeight = Math.floor(metadata.height * (1 / 4) * (1 + errorMargin)); // Added 1% margin
              return sharp(cellPath)
                .extract({
                  left: infoLeft,
                  top: infoTop,
                  width: Math.min(infoWidth, metadata.width - infoLeft),
                  height: Math.min(infoHeight, metadata.height - infoTop)
                })
                .toFile(infoPath);
            });

          //Votos
          const votePath = path.join(tempDir, `vote_${row}_${col}_${filename}.jpg`);
          await sharp(cellPath)
            .metadata()
            .then(metadata => {
              const voteLeft = Math.floor(metadata.width * (1 / 4));
              const voteTop = Math.floor(metadata.height / 2);
              const voteWidth = Math.floor(metadata.width * (3 / 4));
              const voteHeight = Math.floor(metadata.height / 2);
              return sharp(cellPath)
                .extract({
                  left: voteLeft,
                  top: voteTop,
                  width: Math.min(voteWidth, metadata.width - voteLeft),
                  height: Math.min(voteHeight, metadata.height - voteTop)
                })
                .toFile(votePath);
            });

          //const infoText = await readNamesAzureVision(infoPath);
          const infoText = await ocrService.readImageWithGoogleVision(infoPath);
          console.log("INFO")
          const title = result.length > 0 ? result[0].title : await ocrService.readWithTesseract(titlePath);
          console.log("TITLE")
          const number = await ocrService.readNumberWithGoogleVision(numberPath);
          console.log("NUMBER")
          //const infoData = processString(infoText);
          const votou = await ocrService.checkVoted(votePath);

          result.push({
            id: infoText.identidad || `error_${new Date().toISOString()}`,
            votou: votou.votou,
            fullTextInfo: infoText.fullTextInfo,
            needsRevision: infoText.needsRevision || (!infoText.identidad),
            title: title,
            number: number
          });
          ocrService.deleteTempFile(infoPath);
          ocrService.deleteTempFile(numberPath);
          ocrService.deleteTempFile(votePath);
          // Não remova os arquivos temporários para que possamos visualizá-los
          //(`Arquivos salvos: ${cellPath}, ${infoPath}, ${votePath}`);
        } else {
          console.warn(`Skipping cell ${row}_${col} devido a dimensões inválidas`);
        }
      }
    }

    // ocrService.deleteTempFile(cuttedImagePath);
    // ocrService.deleteTempFile(resizedImagePath);
    // ocrService.deleteTempFile(cuttedResizedImagePath);

    res.json(result);
  } catch (error) {
    console.error('Erro ao dividir a imagem:', error);
    res.status(500).json({ success: false, message: 'Erro ao processar a imagem' });
  }
}

exports.getJson = async (req, res) => {
  try {
    const { sortBy, filterBy, currentPage } = req.query; // Parâmetros de ordenação e filtro recebidos via GET
    const itemsPerPage = 5; // Número de itens por página
    // Filtra os dados mockados

    // Caminho para o arquivo mockData.json
    const dataPath = path.join(__dirname, './registros.json');

    // Ler e parsear os dados do arquivo JSON
    const rawData = fs.readFileSync(dataPath, 'utf-8');
    const mockData = JSON.parse(rawData);

    let filteredData = ocrService.filterData(mockData, filterBy);

    let totalItems = filteredData.length;

    // Ordena os dados filtrados
    let sortedData = ocrService.sortData(filteredData, sortBy);

    const startIndex = (+currentPage - 1) * itemsPerPage; // Índice inicial
    const endIndex = startIndex + itemsPerPage; // Índice final
    const paginatedData = sortedData.slice(startIndex, endIndex); // Fatia os dados de acordo com a página

    // Retorna o JSON com os dados paginados
    let response = {
      "total": totalItems,
      "data": paginatedData
    }
    res.json(response);
  } catch (error) {
    console.error('Erro ao recuperar os dados:', error);
    res.status(500).json({ error: 'Erro ao recuperar os dados' });
  }
}

