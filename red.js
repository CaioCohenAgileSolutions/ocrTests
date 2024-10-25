const { PubSub } = require('@google-cloud/pubsub');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
let dotenv = require("dotenv");
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const Tesseract = require('tesseract.js');
const { ComputerVisionClient } = require('@azure/cognitiveservices-computervision');
const { ApiKeyCredentials } = require('@azure/ms-rest-js');

dotenv.config();

const azureVisionClient = new ComputerVisionClient(
  new ApiKeyCredentials({
    inHeader: { 'Ocp-Apim-Subscription-Key': process.env.AZURE_VISION_KEY }, // Chave de API
  }),
  process.env.AZURE_VISION_ENDPOINT // Endpoint da API
);

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
      
      let startIndex = readResult.analyzeResult.readResults[0].lines.findIndex(l => {
        return l.text.includes('redija uma redação dissertativa');
      });
      let strings = "";
      if (startIndex !== -1) { // Se o índice for encontrado
        strings = readResult.analyzeResult.readResults[0].lines
          .slice(startIndex + 1) // Pegar todas as linhas após o índice encontrado
          .map(l => l.text)      // Extrair o campo `text` de cada linha
          .join(' ');            // Concatenar todas as strings em uma única string    
      } else {
        strings = "texto não encontrado";
      }
      return strings;
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
      // console.log(text);
      return result;
    } catch (error) {
      console.error('Erro ao processar a imagem com Tesseract:', error);
      return '';
    }
  }

async function splitImage(imagePath) {
    const tempDir = './tmp';
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir);
    }
    const filename = `temp_image_${uuidv4()}`;

    try {

        const infoText = await readNamesAzureVision(imagePath);  
        
        return infoText;

    } catch(error){
        throw(error)
    }
  }

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
const localImagePath = 'provafolhaunica1.jpg';
processLocalImage(localImagePath);