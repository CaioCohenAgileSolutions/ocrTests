const fs = require('fs');
let dotenv = require("dotenv");
let OpenAI = require('openai');
dotenv.config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

async function readImageWithGPT(imagePath) {
    try {
      // Lê a imagem do caminho e converte para Base64
      const imageBuffer = fs.readFileSync(imagePath);
      const imageBase64 = imageBuffer.toString('base64');
  
      // Prepara o prompt com a descrição da imagem
      const prompt = `Você é um assistente que irá receber uma página de um caderno com informações de 20 eleitores e precisa retornar uma lista de objetos no formato: 
      {
        identidad: null,
        votou: null,
        primeiroNome: null,
        ultimoNome: null,
        apelido: null,
        needsRevision: false,
      } 
      para cada eleitor. O 'needsRevision' virá, como padrão, false. Você saberá se o eleitor votou ou não se existir um carimbo na célula dele. Caso você não consiga ler a identidade do eleitor, talvez porque o carimbo atrapalhou, deixe a identidade como null e marque o 'needsRevision' como true.
  
      A imagem foi fornecida em Base64. Aqui está a imagem codificada: data:image/jpeg;base64,${imageBase64}`;
  
      // Enviar a requisição para a API OpenAI
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini", // Corrigido o nome do modelo
        messages: [
          {
            role: 'system',
            content: `Você é um assistente especializado em processamento de informações de cadernos de eleitores.`
          },
          {
            role: 'user',
            content: prompt // O prompt é uma string com a imagem em Base64 no corpo
          }
        ]
      });
  
      // Retorna a resposta da API
      console.log(response.data);
      return response.data;
  
    } catch (error) {
      console.error('Erro ao enviar a imagem para o GPT:', error.response ? error.response.data : error.message);
      throw error;
    }
  }

// Função principal que processa a imagem localmente
async function processLocalImage(imagePath) {
    try {
        console.log(`Processando o arquivo ${imagePath}`);
        const ocrResults = await readImageWithGPT(imagePath);
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
