import fs from 'node:fs';
import path from 'node:path';

const INPUT_FILE = path.join(
  process.cwd(),
  'data',
  'processed',
  'ram_chunks.json'
);

interface RamChunk {
  id: string;
  article: number;
  chunkIndex: number;
  chapter: string | null;
  section: string | null;
  inciso: string | null;
  text: string;
}

interface RamFile {
  metadata: {
    totalArticles: number;
    totalChunks: number;
  };

  chunks: RamChunk[];
}

function analyzeChunks(): void {
  if (!fs.existsSync(INPUT_FILE)) {
    throw new Error(
      `❌ No existe el archivo:\n${INPUT_FILE}`
    );
  }

  const raw = fs.readFileSync(
    INPUT_FILE,
    'utf-8'
  );

  const data: RamFile =
    JSON.parse(raw);

  const chunks =
    data.chunks;

  const sortedByLength =
    [...chunks].sort(
      (a, b) =>
        a.text.length -
        b.text.length
    );

  console.log(
    `📦 Total de chunks: ${chunks.length}`
  );

  console.log('\n🔎 15 chunks más cortos:\n');

  for (
    const chunk of
      sortedByLength.slice(0, 15)
  ) {
    console.log(
      `ID: ${chunk.id}`
    );

    console.log(
      `Artículo: ${chunk.article}`
    );

    console.log(
      `Longitud: ${chunk.text.length}`
    );

    console.log(
      `Sección: ${chunk.section ?? '-'}`
    );

    console.log(
      `Inciso: ${chunk.inciso ?? '-'}`
    );

    console.log(
      `Texto: "${chunk.text}"`
    );

    console.log(
      '-----------------------------------'
    );
  }

  const under100 =
    chunks.filter(
      (chunk) =>
        chunk.text.length < 100
    );

  const under200 =
    chunks.filter(
      (chunk) =>
        chunk.text.length < 200
    );

  console.log(
    `\n📊 Menores a 100 caracteres: ${under100.length}`
  );

  console.log(
    `📊 Menores a 200 caracteres: ${under200.length}`
  );
}

try {
  analyzeChunks();
} catch (error: any) {
  console.error(
    '\n🔥 Error analizando chunks:'
  );

  console.error(
    error?.message || error
  );
}