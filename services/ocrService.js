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


dotenv.config();


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
    const image = await Jimp.read(imagePath);
    const targetColor = { r: 84, g: 83, b: 96 };

    let matchingPixels = 0;
    const totalPixels = image.bitmap.width * image.bitmap.height;

    // Itera sobre cada pixel da imagem
    image.scan(0, 0, image.bitmap.width, image.bitmap.height, (x, y, idx) => {
      const red = image.bitmap.data[idx];
      const green = image.bitmap.data[idx + 1];
      const blue = image.bitmap.data[idx + 2];

      // Verifica se o pixel é da cor alvo (com tolerância de 10 para cada canal)
      const tolerance = 10;
      if (
        Math.abs(red - targetColor.r) <= tolerance &&
        Math.abs(green - targetColor.g) <= tolerance &&
        Math.abs(blue - targetColor.b) <= tolerance
      ) {
        matchingPixels++;
      }
    });

    // Calcula o percentual de pixels que correspondem à cor alvo
    const percentage = (matchingPixels / totalPixels) * 100;

    const votou = percentage > 1;

    return {
      votou
    };
  } catch (error) {
    console.error('Erro ao ler a imagem:', error);
    throw new Error('Erro ao processar a imagem para contagem de pixels');
  }
};

exports.readImageWithAzureVision = async (imagePath) => {
  try {
    //checkImageDimensions(imagePath);
    // Lê a imagem como um buffer para enviar para a API
    const finalPath = imagePath.split('.')[0] + 'Resized' +'.'+ imagePath.split('.')[1];

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
    let filtrado = readResult.analyzeResult.readResults[0].lines.filter(l =>{
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

