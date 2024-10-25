const { PubSub } = require('@google-cloud/pubsub');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
let dotenv = require("dotenv");
const os = require('os');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const Tesseract = require('tesseract.js');
const { ComputerVisionClient } = require('@azure/cognitiveservices-computervision');
const { ApiKeyCredentials } = require('@azure/ms-rest-js');
let OpenAI = require('openai');

dotenv.config();
// const openai = new OpenAI({
//   apiKey: process.env.OPENAI_API_KEY
// });

async function readImageWithGPT(imagePath) {
  try {
    // Lê a imagem do caminho e converte para Base64
    const imageBuffer = fs.readFileSync(imagePath);
    const imageBase64 = imageBuffer.toString('base64');

    // Prepara o prompt para ser enviado junto com a imagem (se necessário)
    const prompt = "Por favor, analise a imagem fornecida.";

    // Enviar a imagem para a API do OpenAI junto com o prompt
    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: 'system',
          content: `Você é um assistente que irá receber uma página de um caderno com informações de 20 eleitores e precisa retornar uma lista de objetos no formato: 
          {
            identidad: null,
            votou: null,
            primeiroNome: null,
            ultimoNome: null,
            apelido: null,
            needsRevision: false,
          } 
          para cada eleitor. O 'needsRevision' virá, como padrão, false. Você saberá se o eleitor votou ou não se existir um carimbo na célula dele. Caso você não consiga ler a identidade do eleitor, talvez porque o carimbo atrapalhou, deixe a identidade como null e marque o 'needsRevision' como true.`,
        },
        {
          role: 'user',
          content: `${prompt} A imagem está em Base64: ${imageBase64}`,
        },
      ],
    });

    // Retorna a resposta da API
    console.log(response.data);
    return response.data;

  } catch (error) {
    console.error('Erro ao enviar a imagem para o GPT:', error.message);
    throw error;
  }
}


const azureVisionClient = new ComputerVisionClient(
  new ApiKeyCredentials({
    inHeader: { 'Ocp-Apim-Subscription-Key': process.env.AZURE_VISION_KEY }, // Chave de API
  }),
  process.env.AZURE_VISION_ENDPOINT // Endpoint da API
);

// Defina a tolerância inicial para a cor amarela
function parseOCRResult(ocrData) {
  let result = {
    identidad: null,
    votou: null,
    primeiroNome: null,
    ultimoNome: null,
    apelido: null,
    needsRevision: false,
  };

  for (let i = 0; i < ocrData.length; i++) {
    if (ocrData[i].text.includes("Ape")) {
      i++;
      result.apelido = ocrData[i].text; // Pega o restante como apelido
      continue;
    }
    // Verifica se o item contém a palavra "Nombres" para extrair o primeiro nome
    if (ocrData[i].text.includes("Nom")) {
      i++;
      const fullName = ocrData[i].text.split(' ');
      result.primeiroNome = fullName[0]; // Primeiro nome
      result.ultimoNome = fullName[1]; // Último nome
      continue;
    }

    if (ocrData[i].text.includes("Id")) {
      i++;
      result.identidad = ocrData[i].text; // Número de identidade
    }
  }

  const regex = /\d{4}-\d{4}-\d{5}/;
  const match = result?.identidad?.match(regex);
  result.identidad = match ? match[0] : null;
  // Se algum campo essencial (primeiroNome ou identidad) estiver ausente, marcar needsRevision como true
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

async function readImageWithAzureVision(imagePath) {
  try {

    const imageBuffer = fs.readFileSync(imagePath);

    // Envia a imagem para o Azure Vision API para extrair texto
    const result = await azureVisionClient.readInStream(imageBuffer);

    // Extrai o ID da operação
    const operationId = result.operationLocation.split('/').slice(-1)[0];

    // Verifica o status da operação para obter os resultados
    let readResult;
    while (true) {
      readResult = await azureVisionClient.getReadResult(operationId);
      if (readResult.status === 'succeeded') {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Aguarda 1 segundo
    }

    const parsedResult = parseOCRResult(readResult.analyzeResult.readResults[0].lines);

    return parsedResult;
  } catch (error) {
    let result = {
      identidad: null,
      votou: null,
      primeiroNome: null,
      ultimoNome: null,
      apelido: null,
      needsRevision: true,
    };

    return result;
  }
};

// Helper function to read names using Tesseract
async function readNamesAzureVision(imagePath) {
  try {
    if (!fs.existsSync(imagePath)) {
      console.warn(`Arquivo não encontrado: ${imagePath}`);
      return '';
    }

    //const enhancedImagePath = await enhanceImage(imagePath);
    const result = readImageWithAzureVision(imagePath);

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
    return result;
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

    // Analyze the image to find the rotation angle
    const rotationAngle = await findRotationAngle(image);

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
      if (x == 87) {
        console.log("");
      }
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
      if (y == 39) {
        console.log("");
      }
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

    console.log(`Cutting operation: left=${left}, top=${top}, width=${cropWidth}, height=${cropHeight}`);

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

          if (row == 1) {
            console.log("");
          }
          const infoText = await readNamesAzureVision(infoPath);
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
          console.log(`Arquivos salvos: ${cellPath}, ${infoPath}, ${votePath}`);
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
const localImagePath = '1.jpeg';
//const localImagePath = '014.JPG';
//const localImagePath = 'image_2024_10_23T18_45_19_824Z.png';
processLocalImage(localImagePath);
