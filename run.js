const { PubSub } = require('@google-cloud/pubsub');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const Tesseract = require('tesseract.js');

// Helper function to perform OCR using Tesseract
async function readImageWithTesseract(imagePath) {
  try {
    const { data: { text } } = await Tesseract.recognize(imagePath, 'por');
    const regex = /\d{4}-\d{4}-\d{5}/;
    const match = text.match(regex);
    return match ? match[0] : null;
  } catch (error) {
    console.error('Erro ao processar a imagem com Tesseract:', error);
    throw new Error('Erro ao processar a imagem com Tesseract');
  }
}

// Helper function to read names using Tesseract
async function readNamesTesseract(imagePath) {
  try {
    if (!fs.existsSync(imagePath)) {
      console.warn(`Arquivo não encontrado: ${imagePath}`);
      return '';
    }

    const enhancedImagePath = await enhanceImage(imagePath);
    const { data: { text } } = await Tesseract.recognize(enhancedImagePath, 'por');

    // Helper function to enhance image contrast
    async function enhanceImage(inputPath) {
      const outputPath = `${inputPath}_enhanced.jpg`;
      await sharp(inputPath)
        .normalize()
        .modulate({ brightness: 1, saturation: 1.5 })
        .sharpen()
        .toFile(outputPath);
      return outputPath;
    }
    // console.log(text);
    return text;
  } catch (error) {
    console.error('Erro ao processar a imagem com Tesseract:', error);
    return '';
  }
}

// Helper function to process the string and return object with information
function processString(input) {
  const lines = input.split('\n');
  let apelidos, nombres, identidad;

  for (const line of lines) {
    if (line.toLowerCase().includes('apelidos:') || line.toLowerCase().includes('dos:')) {
      apelidos = line.split(/(?:Apelidos:|dos:)\s*/i)[1]?.trim();
    } else if (line.toLowerCase().includes('nombres:') || line.toLowerCase().includes('bres:')) {
      nombres = line.split(/(?:Nombres:|bres:)\s*/i)[1]?.trim();
    } else if (line.toLowerCase().includes('identidad:') || line.toLowerCase().includes('idad:')) {
      identidad = line.split(/(?:Identidad:|idad:)\s*/i)[1]?.trim();
    }
  }

  // If identidad is not found in the usual format, search for it in the entire input

  // Definindo o regex para buscar o padrão dentro da string
  const regex = /\d{4}-\d{4}-\d{5}/;

  // Usar match para buscar a substring que corresponde ao regex
  let match = identidad?.match(regex);

  // Se houver um match, retornamos o valor, caso contrário, retornamos null
  identidad = match ? match[0] : null;

  let needsRevision = false;
  if (!identidad) {
    const identidadMatch = input.match(/\d{4}-\d{4}-\d{5}/);
    if (identidadMatch) {
      identidad = identidadMatch[0];
    }
  } else if (identidad.match(/\d{4}-\d{4}-\d{5}.+/)) {
    identidad = identidad.match(/\d{4}-\d{4}-\d{5}/)[0];
    needsRevision = true;
  }

  return {
    apelido: apelidos,
    primeiroNome: nombres ? nombres.split(' ')[0] : '',
    ultimoNome: nombres ? nombres.split(' ').slice(1).join(' ') : '',
    identidad: identidad ? identidad.replace(/(\d{4})(\d{4})(\d{5}).*/, '$1-$2-$3') : '',
    needsRevision: needsRevision
  };

  return {};
}

// Helper function to check for "voted" status in the image
async function checkVoted(imagePath) {
  try {
    if (!fs.existsSync(imagePath)) {
      console.warn(`Arquivo não encontrado: ${imagePath}`);
      return { votou: false };
    }
    const { data, info } = await sharp(imagePath).raw().toBuffer({ resolveWithObject: true });
    const targetColor = { r: 84, g: 83, b: 96 };
    let matchingPixels = 0;
    const totalPixels = info.width * info.height;
    const tolerance = 10;

    for (let i = 0; i < data.length; i += 3) {
      if (
        Math.abs(data[i] - targetColor.r) <= tolerance &&
        Math.abs(data[i + 1] - targetColor.g) <= tolerance &&
        Math.abs(data[i + 2] - targetColor.b) <= tolerance
      ) {
        matchingPixels++;
      }
    }

    return { votou: (matchingPixels / totalPixels) * 100 > 1 };
  } catch (error) {
    console.error('Erro ao ler a imagem:', error);
    return { votou: false };
  }
}

// Helper function to remove image borders and correct rotation
async function cutImageBorders(imagePath) {
  try {
    const outputPath = path.join(path.dirname(imagePath), 'images-cutted', path.basename(imagePath));

    if (!fs.existsSync(path.dirname(outputPath))) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    }

    // Read the image
    const image = sharp(imagePath);
    const { width, height } = await image.metadata();

    // Analyze the image to find the rotation angle
    const rotationAngle = await findRotationAngle(image);

    // Rotate the image if necessary
    const rotatedImage = rotationAngle !== 0 ? image.rotate(rotationAngle) : image;

    // Trace a line from the middle of the top to the image
    const { data } = await rotatedImage.raw().toBuffer({ resolveWithObject: true });
    // Especificar as coordenadas do pixel de interesse
    const x = 24; // Coordenada X do pixel (ajuste conforme necessário para a borda amarela)
    const y = 40; // Coordenada Y do pixel (ajuste conforme necessário para a borda amarela)

    const idx = (y * width + x) * 3; // Índice do pixel no array de dados da imagem
    const r = data[idx];   // Valor Red (R)
    const g = data[idx + 1]; // Valor Green (G)
    const b = data[idx + 2]; // Valor Blue (B)

    console.log(`Valores RGB do pixel em (${x}, ${y}): R=${r}, G=${g}, B=${b}`);

    // Verificar se o pixel é amarelo ou branco
    // Amarelo típico é algo como (255, 255, 0) enquanto branco seria algo como (255, 255, 255)
    let typeOfImage;
    if (r > 200 && g > 200 && b > 200) {
      typeOfImage = 'B'; // Se o pixel for branco
    } else {
      typeOfImage = 'A'; // Se o pixel for amarelo
    }

    let left, top, cropWidth, cropHeight;


    // Use the provided dimensions for cropping
    if (typeOfImage === 'A') {
      left = 65;
      top = 169;
      cropWidth = 2057;
      cropHeight = 1321;
    } else {
      left = 105;
      top = 209;
      cropWidth = 1877;
      cropHeight = 1241;
    }

    console.log({ width, height, left, top, cropWidth, cropHeight });

    console.log(`Rotation angle: ${rotationAngle}`);
    console.log(`Cutting operation: left=${left}, top=${top}, width=${cropWidth}, height=${cropHeight}`);

    // Apply rotation (if any) and crop
    await rotatedImage
      .extract({ left, top, width: cropWidth, height: cropHeight })
      .toFormat('jpeg')  // Explicitly set the output format to JPEG
      .toFile(outputPath);

    return outputPath;
  } catch (error) {
    console.error('Error in cutImageBorders:', error);
    throw error;
  }
}

// Helper function to find the rotation angle
async function findRotationAngle(image) {
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;

  let maxLineLength = 0;
  let bestAngle = 0;

  for (let y = 0; y < height; y += 10) { // Check every 10th row for efficiency
    let lineStart = -1;
    let lineEnd = -1;

    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 3;
      const isBlack = data[idx] < 50 && data[idx + 1] < 50 && data[idx + 2] < 50;

      if (isBlack) {
        if (lineStart === -1) lineStart = x;
        lineEnd = x;
      }
    }

    if (lineEnd - lineStart > maxLineLength) {
      maxLineLength = lineEnd - lineStart;
      const angle = Math.atan2(10, lineEnd - lineStart) * (180 / Math.PI);
      bestAngle = angle;
    }
  }

  return bestAngle;
}

// Helper function to split image into parts
async function splitImage(imagePath) {
  const tempDir = './tmp';
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir);
  }
  const filename = `temp_image_${uuidv4()}`;

  try {
    // First, remove the borders
    const cuttedImagePath = await cutImageBorders(imagePath);

    const { width, height } = await sharp(cuttedImagePath).metadata();

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
          const cellPath = path.join(tempDir, `cell_${row}_${col}_${filename}.jpg`);
          await sharp(cuttedImagePath)
            .extract({
              left: cellLeft,
              top: cellTop,
              width: Math.min(cellWidth, width - cellLeft),
              height: Math.min(cellHeight, height - cellTop)
            })
            .toFile(cellPath);

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

          const infoText = await readNamesTesseract(infoPath);
          const infoData = processString(infoText);
          const votou = await checkVoted(votePath);

          result.push({
            id: infoData.identidad || `error_${new Date().toISOString()}`,
            votou: votou.votou,
            primeiroNome: infoData.primeiroNome,
            ultimoNome: infoData.ultimoNome,
            apelido: infoData.apelido,
            needsRevision: infoData.needsRevision || (!infoData.identidad)
          });

          // Não remova os arquivos temporários para que possamos visualizá-los
          console.log(`Arquivos salvos: ${cellPath}, ${infoPath}, ${votePath}`);
        } else {
          console.warn(`Skipping cell ${row}_${col} due to invalid dimensions`);
        }
      }
    }

    return result;
  } catch (error) {
    console.error('Erro ao dividir a imagem:', error);
    throw error;
  }
}

// Função principal que processa a imagem localmente
async function processLocalImage(imagePath) {
  try {
    console.log(`Processando o arquivo ${imagePath}`);
    const ocrResults = await splitImage(imagePath);
    console.log('Resultados do OCR:', JSON.stringify(ocrResults, null, 2));
  } catch (error) {
    console.error('Erro ao processar a imagem com OCR:', error);
  }
}

// Executa o processamento da imagem local
//const localImagePath = '3.JPG';
const localImagePath = '1.jpeg';
processLocalImage(localImagePath);