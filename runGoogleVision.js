const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
let dotenv = require("dotenv");
const { v4: uuidv4 } = require('uuid');
const Tesseract = require('tesseract.js');
const vision = require('@google-cloud/vision');
let OpenAI = require('openai');

dotenv.config();
// const openai = new OpenAI({
//   apiKey: process.env.OPENAI_API_KEY
// });

// Creates a client for Google Vision
const clientGoogleVision = new vision.ImageAnnotatorClient();

async function readImageWithGoogleVision(imagePath) {
  try {
      // Reads the image file into a buffer
      const [result] = await clientGoogleVision.textDetection(imagePath);
      const detections = result.textAnnotations;

      if (!detections.length) {
          throw new Error('No text detected in the image.');
      }

      // You can get the full OCR text like this:
      const fullText = detections[0].description;

      // Process the text annotations and extract details for each voter
      const voters = [];
      return parseOCRResult(fullText);

      return voters;

  } catch (error) {
      console.error('Error during text detection with Google Vision:', error);
      throw error;
  }
}


// Defina a tolerância inicial para a cor amarela
function parseOCRResult(ocrData) {
  let result = {
    identidad: null,
    votou: null,
    fullTextInfo: null,
    needsRevision: false,
  };
  const regex = /\d{4}-\d{4}-\d{5}/;
  let matches = ocrData.match(regex);
  if(matches?.length > 0){
    result.identidad = matches[0];
  }else{
    result.identidad = "nao reconhecido"
  }
  result.fullTextInfo = ocrData;

  if (!result.identidad) {
    result.needsRevision = true;
  }

  return result;
}
// Helper function to perform OCR using Tesseract
async function readWithTesseract(imagePath, regex = null) {
  try {
    const { data: { text } } = await Tesseract.recognize(imagePath, 'spa');
    if (regex){
      const match = text.match(regex);
      return match ? match[0] : text;
    }
    return text;
  } catch (error) {
    console.error('Erro ao processar a imagem com Tesseract:', error);
    throw new Error('Erro ao processar a imagem com Tesseract');
  }
}

// Helper function to check for "voted" status in the image
async function checkVoted(imagePath) {
  try {
    if (!fs.existsSync(imagePath)) {
      console.warn(`Arquivo não encontrado: ${imagePath}`);
      return { votou: false };
    }
    const { data, info } = await sharp(imagePath).raw().toBuffer({ resolveWithObject: true });
    let matchingPixels = 0;
    const totalPixels = info.width * info.height;
    let tolerance = 10;

    for (let i = 0; i < data.length; i += 3) {
      if (
        data[i] < 200 &&
        data[i + 1] < 200 &&
        data[i + 2] < 200
      ) {
        matchingPixels++;
      }
    }

    let per = (matchingPixels / totalPixels) * 100;
    return { votou: per > 5 };
  } catch (error) {
    console.error('Erro ao ler a imagem:', error);
    return { votou: false };
  }
}

let tolerance = 1; // Ajuste conforme necessário
// Define tolerances for white and yellow
let whiteTolerance = 5; // Adjust as needed
let yellowTolerance = 5; // Adjust as needed
// Helper function to remove image borders and correct rotation

async function resizeImage(imagePath) {
  try {
    const outputDir = path.join(path.dirname(imagePath), 'resized');
    const outputPath = path.join(outputDir, path.basename(imagePath));

    // Verificar se o diretório de saída existe, e criar se não existir
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Redimensionar a imagem
    await sharp(imagePath)
      .resize({
        width: 2126,
        fit: sharp.fit.inside,
      })
      .toFile(outputPath);

    return outputPath;

  } catch (error) {
    console.error('Erro ao redimensionar a imagem:', error);
  }
}

async function cutResizedBorders(imagePath) {
  try {
    const outputDir = path.join(path.dirname(imagePath), 'finalResult');
    const outputPath = path.join(outputDir, path.basename(imagePath));

    // Verificar se o diretório de saída existe, e criar se não existir
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const image = sharp(imagePath);
    // Redimensionar a imagem
    await image
      .extract({ left: 32, top: 137, width: 2062, height: 1326 })
      .toFormat('jpeg')  // Explicitly set the output format to JPEG
      .toFile(outputPath);

    return outputPath;

  } catch (error) {
    console.error('Erro ao redimensionar a imagem:', error);
  }
}

async function cutImageBorders(imagePath) {
  try {
    const outputPath = path.join(path.dirname(imagePath), 'images-cutted', path.basename(imagePath));

    if (!fs.existsSync(path.dirname(outputPath))) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    }

    // Read the image
    const image = sharp(imagePath);
    const { width, height } = await image.metadata();

    // Rotate the image if necessary
    //const rotatedImage = rotationAngle !== 0 ? image.rotate(rotationAngle) : image;

    // Trace a line from the middle of the top to the image
    const { data } = await image.raw().toBuffer({ resolveWithObject: true });

    let x1, y1, x2, y2;
    // const whiteColor = { r: 255, g: 255, b: 255 };
    // const yellowColor = { r: 233, g: 193, b: 130 };


    function isTransitionFromWhiteToYellow(data, x, y, width, height) {
      const idx = (y * width + x) * 3;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      return r > 200 && b < 200;
    }

    //checa onde esta o primeiro pixel amarelo da esquerda pra direita, comecando do meio da imagem
    for (let x = 0; x < width; x++) {
      let y = Math.floor(height / 2);
      if (isTransitionFromWhiteToYellow(data, x, y, width, height)) {
        x1 = x;
        console.log(`Found left border at ${x1}`);
        break;
      }
    }
    //checa onde esta o primeiro pixel amarelo da direita pra esquerda, comecando do meio da imagem
    for (let x = width; x >= 0; x--) {
      if (isTransitionFromWhiteToYellow(data, x, Math.floor(height / 2), width, height)) {
        x2 = x;
        console.log(`Found right border at ${x2}`);
        break;
      }
    }

    //checa onde esta o primeiro pixel amarelo de cima pra baixo, comecando do meio da imagem
    for (let y = 0; y < height; y++) {
      if (isTransitionFromWhiteToYellow(data, Math.floor(width / 2), y, width, height)) {
        y1 = y;
        console.log(`Found top border at ${y1}`);
        break;
      }
    }

    //checa onde esta o primeiro pixel amarelo de cima pra baixo, comecando do meio da imagem
    for (let y = height; y >= 0; y--) {
      if (isTransitionFromWhiteToYellow(data, Math.floor(width / 2), y, width, height)) {
        y2 = y;
        console.log(`Found bottom border at ${y2}`);
        break;
      }
    }

    if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
      throw new Error('Pontos que saem do branco não encontrados na imagem.');
    }

    // Calcular as dimensões do corte
    const left = x1;
    const top = y1;
    const cropWidth = Math.abs(x2 - x1);
    const cropHeight = Math.abs(y2 - y1);

    //console.log({ width, height, left, top, cropWidth, cropHeight });

    //console.log(`Cutting operation: left=${left}, top=${top}, width=${cropWidth}, height=${cropHeight}`);

    // Verificar se as dimensões de corte são válidas
    // if (cropWidth < 500 || cropHeight < 500) {
    //   console.log('Dimensões de corte muito pequenas. Diminuindo a tolerância e tentando novamente.');
    //   whiteTolerance += 1; // Ajuste a tolerância
    //   yellowTolerance += 1; // Ajuste a tolerância
    //   return await cutImageBorders(imagePath); // Tente novamente com a nova tolerância
    // }

    // Apply rotation (if any) and crop
    if (cropWidth > 0 && cropHeight > 0) {
      await image
        .extract({ left, top, width: cropWidth, height: cropHeight })
        .toFormat('jpeg')  // Explicitly set the output format to JPEG
        .toFile(outputPath);
    } else {
      // If cropWidth or cropHeight is 0, use the full image dimensions
      await image
        .toFormat('jpeg')
        .toFile(outputPath);
    }

    return outputPath;
  } catch (error) {
    console.error('Error in cutImageBorders:', error);
    throw error;
  }
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
    const resizedImagePath = await resizeImage(cuttedImagePath);
    const cuttedResizedImagePath = await cutResizedBorders(resizedImagePath);

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
          const infoText = await readImageWithGoogleVision(infoPath);
          const title = result.length > 0 ? result[0].title : await readWithTesseract(titlePath);
          const number = await readWithTesseract(numberPath);

          //const infoData = processString(infoText);
          const votou = await checkVoted(votePath);

          result.push({
            id: infoText.identidad || `error_${new Date().toISOString()}`,
            votou: votou.votou,
            primeiroNome: infoText.primeiroNome,
            ultimoNome: infoText.ultimoNome,
            apelido: infoText.apelido,
            needsRevision: infoText.needsRevision || (!infoText.identidad),
            title: title,
            number: number
          });

          // Não remova os arquivos temporários para que possamos visualizá-los
          //(`Arquivos salvos: ${cellPath}, ${infoPath}, ${votePath}`);
        } else {
          console.warn(`Skipping cell ${row}_${col} devido a dimensões inválidas`);
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
//const localImagePath = '1.jpeg';
//const localImagePath = '014.JPG';
//const localImagePath = 'image_2024_10_23T18_45_19_824Z.png';
const localImagePath = '049.JPG';
processLocalImage(localImagePath);
