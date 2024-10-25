const express = require('express');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const Tesseract = require('tesseract.js');
const { Jimp } = require('jimp');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Função para processar a string e retornar o objeto com as informações
function processString(input) {
  const lines = input.split('\n'); // Dividir a string por linhas
  let obj = {};

  // Extrair os valores de "Apelliidos" e "Nombres"
  const apelidoLine = lines.find(line => line.startsWith('Ap'));
  const nombresLine = lines.find(line => line.startsWith('Nom'));

  if (apelidoLine && nombresLine) {
    const apelido = apelidoLine.split(': ')[1]?.trim();
    const nombres = nombresLine.split(': ')[1]?.trim();

    if (apelido && nombres) {
      const apelidoParts = apelido.split(' ');
      const nombresParts = nombres.split(' ');

      obj = {
        primeiroNome: nombresParts[0] || '',
        ultimoNome: nombresParts.slice(1).join(' ') || '', // O resto é o último nome
        apelido: apelido
      };
    }
  }

  return obj;
}

// Helper functions
async function resizeImageIfNeeded(imagePath, finalPath) {
  try {
    const metadata = await sharp(imagePath).metadata();
    let width = metadata.width;
    let height = metadata.height;

    while (width < 50 || height < 50) {
      width *= 2;
      height *= 2;
      await sharp(imagePath)
        .resize({
          width: width,
          height: height,
          fit: sharp.fit.inside,
        })
        .toFile(finalPath);
    }
  } catch (error) {
    console.error('Erro ao redimensionar a imagem:', error);
  }
}

async function readImageWithTesseract(imagePath) {
  try {
    const finalPath = imagePath.split('.')[0] + 'Resized' + '.' + imagePath.split('.')[1];
    await resizeImageIfNeeded(imagePath, finalPath);

    const { data: { text } } = await Tesseract.recognize(fs.existsSync(finalPath) ? finalPath : imagePath, 'por');

    // Definindo o regex para buscar o padrão dentro da string
    const regex = /\d{4}-\d{4}-\d{5}/;

    // Usar match para buscar a substring que corresponde ao regex
    const match = text.match(regex);

    // Se houver um match, retornamos o valor, caso contrário, retornamos null
    return match ? match[0] : null;

  } catch (error) {
    console.error('Erro ao processar a imagem com Tesseract:', error);
    throw new Error('Erro ao processar a imagem com Tesseract');
  }
}

async function readNamesTesseract(imagePath) {
  try {
    const finalPath = imagePath.split('.')[0] + 'Resized' + '.' + imagePath.split('.')[1];
    await resizeImageIfNeeded(imagePath, finalPath);

    const { data: { text } } = await Tesseract.recognize(fs.existsSync(finalPath) ? finalPath : imagePath, 'por');

    // const regex = /^\d{4}-\d{4}-\d{5}$/;
    // let filtrado = text.split('\n').filter(line => regex.test(line.trim()));

    return text;
  } catch (error) {
    console.error('Erro ao processar a imagem com Tesseract:', error);
    throw new Error('Erro ao processar a imagem com Tesseract');
  }
}

async function checkVoted(imagePath) {
  try {
    const image = await Jimp.read(imagePath);
    const targetColor = { r: 84, g: 83, b: 96 };

    let matchingPixels = 0;
    const totalPixels = image.bitmap.width * image.bitmap.height;

    image.scan(0, 0, image.bitmap.width, image.bitmap.height, (x, y, idx) => {
      const red = image.bitmap.data[idx];
      const green = image.bitmap.data[idx + 1];
      const blue = image.bitmap.data[idx + 2];

      const tolerance = 10;
      if (
        Math.abs(red - targetColor.r) <= tolerance &&
        Math.abs(green - targetColor.g) <= tolerance &&
        Math.abs(blue - targetColor.b) <= tolerance
      ) {
        matchingPixels++;
      }
    });

    const percentage = (matchingPixels / totalPixels) * 100;
    return { votou: percentage > 1 };
  } catch (error) {
    console.error('Erro ao ler a imagem:', error);
    throw new Error('Erro ao processar a imagem para contagem de pixels');
  }
}

async function combineImagesVertically(imageParts, outputCombinedPath) {
  try {
    const images = await Promise.all(imageParts.map(part => sharp(part).toBuffer()));
    const { width } = await sharp(images[0]).metadata();
    const totalHeight = await images.reduce(async (sum, imgBuffer) => {
      const { height } = await sharp(imgBuffer).metadata();
      return (await sum) + height;
    }, 0);

    let compositeOptions = [];
    let currentHeight = 0;

    for (let imgBuffer of images) {
      const { height } = await sharp(imgBuffer).metadata();
      compositeOptions.push({ input: imgBuffer, top: currentHeight, left: 0 });
      currentHeight += height;
    }

    await sharp({
      create: {
        width: width,
        height: totalHeight,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .composite(compositeOptions)
      .toFile(outputCombinedPath);

    console.log('Imagem combinada salva:', outputCombinedPath);
  } catch (error) {
    console.error('Erro ao combinar as imagens:', error);
  }
}

async function splitImage(base64Image) {
  //const tempDir = os.tmpdir();
  const tempDir = path.resolve('uploads/ids'); // Diretório de saída para as imagens divididas
  const filename = `temp_image_${uuidv4()}`;
  const imagePath = path.join(tempDir, `${filename}.jpg`);

  try {
    const buffer = Buffer.from(base64Image, 'base64');
    fs.writeFileSync(imagePath, buffer);

    let width = 2050;
    let height = 1330;
    let rows = 5;
    let cols = 4;

    const trimmedImagePath = path.join(tempDir, `trimmed_${filename}.jpg`);

    await sharp(imagePath)
      .extract({ left: 100, top: 170, width, height })
      .toFile(trimmedImagePath);

    const splitImagePathsIds = [];
    let result = [];

    //IDs    

    // const combinedImagePath = path.join(tempDir, `combined_${filename}.jpg`);
    // await combineImagesVertically(splitImagePathsIds, combinedImagePath);

    try {
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const left = Math.floor(col * (width / cols)) + 220 - (col * 5);
          const top = Math.floor(row * (height / rows)) + 100 - (row * 4);
          const partWidth = Math.floor((width / cols) / 3);
          const partHeight = Math.floor((height / rows) / 12);

          const outputPath = path.join(tempDir, `part_${row}_${col}_${filename}.jpg`);
          await sharp(trimmedImagePath)
            .extract({ left, top, width: partWidth, height: partHeight })
            .toFile(outputPath);

          splitImagePathsIds.push(outputPath);
          const id = await readImageWithTesseract(outputPath);
          if (id) {
            result.push({
              id: id,
              votou: null,
              primeiroNome: null,
              ultimoNome: null,
              apelido: null,
              needsRevision: false
            })
          } else {
            const timestamp = new Date().toISOString();
            result.push({
              id: `error_${timestamp}`,
              votou: null,
              primeiroNome: null,
              ultimoNome: null,
              apelido: null,
              needsRevision: true
            });
          }
        }
      }
    } catch (error) {
      // If error occurs, set error identifier and needsRevision flag
      throw (error);
    }


    const splitImagePathsVotes = [];
    let i = 0;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const left = Math.floor(col * (width / cols)) + 130 - (col * 5);
        const top = Math.floor(row * (height / rows)) + 115 - (row * 4);
        const partWidth = Math.floor((width / cols) * 0.70);
        const partHeight = Math.floor((height / rows) / 2);

        const outputPath = path.join(tempDir, `part_vote_${row}_${col}_${filename}.jpg`);

        await sharp(trimmedImagePath)
          .extract({ left, top, width: partWidth, height: partHeight })
          .toFile(outputPath);

        const votou = await checkVoted(outputPath);
        if (result[i]) {
          result[i].votou = votou.votou;
        }
        i++;

        splitImagePathsVotes.push(outputPath);
      }
    }

    //NOMES
    const splitImagePathsNames = [];
    i = 0;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const left = Math.floor(col * (width / cols)) + 130 - (col * 5);
        const top = Math.floor(row * (height / rows)) + 60 - (row * 4);
        const partWidth = Math.floor((width / cols) * 0.70);
        const partHeight = Math.floor((height / rows) / 6);

        const outputPath = path.join(tempDir, `part_name_${row}_${col}_${filename}.jpg`);

        await sharp(trimmedImagePath)
          .extract({ left, top, width: partWidth, height: partHeight })
          .toFile(outputPath);

        try {
          const names = await readNamesTesseract(outputPath);

          let infoNome = processString(names)
          if (result[i]) {
            result[i].primeiroNome = infoNome.primeiroNome;
            result[i].ultimoNome = infoNome.ultimoNome;
            result[i].apelido = infoNome.apelido;
          }
        } catch (error) {
          // If error occurs, set error identifier and needsRevision flag
          const timestamp = new Date().toISOString();
          result[i].primeiroNome = `error_${timestamp}`;
          result[i].needsRevision = true;
        }
        i++;

        splitImagePathsNames.push(outputPath);
      }
    }

    // Clean up temporary files
    // fs.unlinkSync(imagePath);
    // fs.unlinkSync(trimmedImagePath);
    // splitImagePathsIds.forEach(p => fs.unlinkSync(p));
    // splitImagePathsVotes.forEach(p => fs.unlinkSync(p));
    // fs.unlinkSync(combinedImagePath);

    //comentado pois estava dando erro
    return result;
  } catch (error) {
    console.error('Erro ao dividir a imagem:', error);
    throw new Error('Erro ao dividir a imagem');
  }
}

// Main route for image processing
app.post('/processImage', async (req, res) => {
  try {
    if (!req.body.base64Image) {
      return res.status(400).json({ error: 'Nenhuma imagem em Base64 enviada' });
    }

    const result = await splitImage(req.body.base64Image);
    res.json(result);
  } catch (error) {
    console.error('Erro ao processar a imagem:', error);
    res.status(500).json({ error: 'Erro ao processar a imagem' });
  }
});

// Add a root route to handle the POST request to '/'
app.post('/', async (req, res) => {
  try {
    if (!req.body.base64Image) {
      return res.status(400).json({ error: 'Nenhuma imagem em Base64 enviada' });
    }

    const result = await splitImage(req.body.base64Image);
    res.json(result);
  } catch (error) {
    console.error('Erro ao processar a imagem:', error);
    res.status(500).json({ error: 'Erro ao processar a imagem' });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
