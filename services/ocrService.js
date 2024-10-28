const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const { Jimp } = require("jimp");
let OpenAI = require('openai');
let dotenv = require("dotenv");
const sharp = require('sharp');
const { ComputerVisionClient } = require('@azure/cognitiveservices-computervision');
const { ApiKeyCredentials } = require('@azure/ms-rest-js');
const Tesseract = require('tesseract.js');
const vision = require('@google-cloud/vision');
const { v4: uuidv4 } = require('uuid');



dotenv.config();

const clientGoogleVision = new vision.ImageAnnotatorClient();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const azureVisionClient = new ComputerVisionClient(
  new ApiKeyCredentials({
    inHeader: { 'Ocp-Apim-Subscription-Key': process.env.AZURE_VISION_KEY }, // Chave de API
  }),
  process.env.AZURE_VISION_ENDPOINT // Endpoint da API
);

function imageToBase64(imagePath) {
  try {
    // Read the image as a binary buffer
    const imageBuffer = fs.readFileSync(imagePath);

    // Convert the buffer to a base64 string
    const base64Image = imageBuffer.toString('base64');

    return base64Image;
  } catch (error) {
    console.error('Error converting image to Base64:', error);
    throw error;
  }
}

async function checkImageDimensions(imagePath) {
  try {
    // Obtém as informações de metadata da imagem (incluindo dimensões)
    const metadata = await sharp(imagePath).metadata();

    // Exibe as dimensões da imagem
    console.log(`A imagem tem ${metadata.width} x ${metadata.height} pixels`);

    // Verifica se as dimensões estão dentro do intervalo permitido
    if (
      metadata.width < 50 || metadata.height < 50 ||
      metadata.width > 10000 || metadata.height > 10000
    ) {
      console.error('As dimensões da imagem estão fora do intervalo permitido pela Azure Vision API.');
    } else {
      console.log('As dimensões da imagem estão dentro do intervalo permitido.');
    }
  } catch (error) {
    console.error('Erro ao verificar as dimensões da imagem:', error);
  }
}

async function resizeImageIfNeeded(imagePath, finalPath) {
  try {
    const metadata = await sharp(imagePath).metadata();
    let width = metadata.width;
    let height = metadata.height;

    while (
      width < 50 || height < 50
    ) {
      // Redimensiona a imagem para caber no limite permitido
      width *= 2;
      height *= 2;
      const resizedImage = await sharp(imagePath)
        .resize({
          width: width, // Ajusta a largura para no máximo  
          height: height, // Ajusta a altura para no máximo 
          fit: sharp.fit.inside, // Mantém a proporção
        })
        .toFile(finalPath);

      //console.log('Imagem redimensionada com sucesso:', finalPath);
    }
  } catch (error) {
    console.error('Erro ao redimensionar a imagem:', error);
  }
}

function parseOCRResult(ocrData) {
  let result = {
    identidad: null,
    votou: null,
    fullTextInfo: null,
    needsRevision: false,
  };
  const regex = /\d{4}-\d{4}-\d{5}/;
  let matches = ocrData.match(regex);
  if (matches?.length > 0) {
    result.identidad = matches[0];
  } else {
    result.identidad = "nao reconhecido"
  }
  result.fullTextInfo = ocrData;

  if (!result.identidad) {
    result.needsRevision = true;
  }

  return result;
}

exports.readImageWithAI = async (imagePath) => {
  try {
    // Lê a imagem como um buffer
    const base64Image = imageToBase64(imagePath);

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "give me the numbers that you can read in the following image, answer me like you were an OCR, which means, only the numbers and nothing else." },
            {
              type: "image_url",
              image_url: {
                "url": `data:image/jpeg;base64,${base64Image}`,
              },
            },
          ],
        },
      ],
    });

    // Processa a resposta da API e retorna o texto ou número extraído
    const extractedText = response.choices[0].message.content; // Isso depende da estrutura de resposta retornada pela API

    // Extraindo apenas os números usando uma expressão regular
    const extractedNumbers = extractedText.split("-").join("");

    return extractedNumbers ? extractedNumbers : 'Nenhum número encontrado';
  } catch (error) {
    console.error('Erro ao chamar a API da OpenAI:', error);
    throw new Error('Erro ao processar a imagem com a OpenAI');
  }
};

exports.resizeImage = async (imagePath) => {
  try {
    const outputDir = path.join(path.dirname(imagePath), 'resized');

    // Gera um nome de arquivo temporário exclusivo usando uuidv4
    const uniqueFilename = `${uuidv4()}_${path.basename(imagePath)}`;

    // Combina o diretório e o nome exclusivo
    const outputPath = path.join(outputDir, uniqueFilename);

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
};

exports.readWithTesseract = async (imagePath, regex = null) => {
  try {
    const { data: { text } } = await Tesseract.recognize(imagePath, 'spa');
    if (regex) {
      const match = text.match(regex);
      return match ? match[0] : text;
    }
    return text;
  } catch (error) {
    console.error('Erro ao processar a imagem com Tesseract:', error);
    throw new Error('Erro ao processar a imagem com Tesseract');
  }
};


exports.readImageWithGoogleVision = async (imagePath) => {
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
  } catch (error) {
    console.error('Error during text detection with Google Vision:', error);
    throw error;
  }
};

exports.readNumberWithGoogleVision = async (imagePath) => {
  try {
    // Reads the image file into a buffer
    const [result] = await clientGoogleVision.textDetection(imagePath);
    const detections = result.textAnnotations;

    if (!detections.length) {
      throw new Error('No text detected in the image.');
    }

    // You can get the full OCR text like this:
    const fullText = detections[0].description;

    return fullText;

  } catch (error) {
    console.error('Error during text detection with Google Vision:', error);
    throw error;
  }
};

exports.cutResizedBorders = async (imagePath) => {
  try {
    // Gera um nome de arquivo temporário exclusivo usando uuidv4
    const uniqueFilename = `${uuidv4()}_${path.basename(imagePath)}`;

    // Combina o diretório e o nome exclusivo
    const outputDir = path.join(path.dirname(imagePath), 'finalResult');
    const outputPath = path.join(outputDir, uniqueFilename);

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
};

exports.cutImageBorders = async (imagePath) => {
  try {
    // Gera um nome de arquivo temporário exclusivo usando uuidv4
    const uniqueFilename = `${uuidv4()}_${path.basename(imagePath)}`;

    // Combina o diretório e o nome exclusivo
    const outputPath = path.join(path.dirname(imagePath), 'images-cutted', uniqueFilename);

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
};


exports.readImage = async (imagePath, mimetype) => {
  try {
    // Obtém a extensão do arquivo e o tipo MIME dinamicamente
    const fileBuffer = fs.readFileSync(imagePath);

    // Convert the binary data to a base64 string
    const base64String = fileBuffer.toString('base64');

    // Cria um objeto FormData e anexa a imagem
    const formData = new FormData();
    formData.append('apikey', 'K85545853588957'); // Substitua pela sua chave de API do OCR.space
    formData.append('language', 'eng'); // Define o idioma (ajuste conforme necessário)
    formData.append('isOverlayRequired', "true"); // Adiciona a extensão do arquivo dinamicamente
    formData.append('base64Image', `data:${mimetype};base64,${base64String}`);

    // Faz a requisição para a API do OCR.space
    const response = await axios.post('https://api.ocr.space/parse/image', formData);

    // Verifica se houve sucesso na resposta
    if (response.data.OCRExitCode === 1) {
      const extractedText = response.data.ParsedResults[0].ParsedText;

      // Extraindo apenas os números usando uma expressão regular
      const extractedNumbers = extractedText.match(/\d+/g);

      return extractedNumbers.join("") || []; // Retorna os números extraídos ou uma lista vazia
    } else {
      throw new Error(response.data.ErrorMessage || 'Erro ao processar a imagem');
    }
  } catch (error) {
    console.error('Erro ao chamar a API de OCR:', error);
    throw new Error('Erro ao processar a imagem com OCR');
  }
};

exports.checkVoted = async (imagePath) => {
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
};

exports.deleteTempFile = async (imagePath) => {
  try {
    fs.unlink(imagePath, (err) => {
      if (err) {
        console.error(`Erro ao excluir o arquivo temporário: ${imagePath}`, err);
      }
    });
  } catch (error) {
    console.error('Erro ao deletar a imagem:', error);
    return { votou: false };
  }
};


exports.readImageWithAzureVision = async (imagePath) => {
  try {
    //checkImageDimensions(imagePath);
    // Lê a imagem como um buffer para enviar para a API
    const finalPath = imagePath.split('.')[0] + 'Resized' + '.' + imagePath.split('.')[1];

    _ = await resizeImageIfNeeded(imagePath, finalPath);

    const imageBuffer = fs.readFileSync(fs.existsSync(finalPath) ? finalPath : imagePath);

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

    // Extrai os números do texto lido pela API
    const regex = /^\d{4}-\d{4}-\d{5}$/
    let filtrado = readResult.analyzeResult.readResults[0].lines.filter(l => {
      return regex.test(l.text);
    })

    return filtrado;
  } catch (error) {
    console.error('Erro ao processar a imagem com Azure Vision:', error);
    throw new Error('Erro ao processar a imagem com Azure Vision');
  }
};

exports.sortData = (data, sortBy) => {
  if (sortBy === 'nome') {
    return data.sort((a, b) => a.nome.localeCompare(b.nome));
  } else if (sortBy === 'mesa') {
    return data.sort((a, b) => a.mesa.localeCompare(b.mesa));
  } else if (sortBy === 'votou') {
    return data.sort((a, b) => b.votou - a.votou);
  }
  return data;
};

exports.filterData = (data, filterBy) => {
  if (filterBy) {
    return data.filter((item) => item.nome.toLowerCase().includes(filterBy.toLowerCase()));
  }
  return data;
};

