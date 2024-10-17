const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const { Jimp } = require("jimp");


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
    const targetColor = { r: 84, g: 83, b: 96 }; // Exemplo: vermelho puro

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

