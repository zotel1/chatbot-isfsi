import fs from 'node:fs';
import path from 'node:path';
import mammoth from 'mammoth';

// =====================================================
// CONFIGURACIÓN
// =====================================================

const SOURCE_FILE = path.join(
  process.cwd(),
  'data',
  'source',
  'ram',
  'ram-res-4916-2025.docx'
);

const OUTPUT_FILE = path.join(
  process.cwd(),
  'data',
  'processed',
  'ram_chunks.json'
);

const SOURCE_ID = 'ram-res-4916-2025';

const DOCUMENT_NAME = 'Régimen Académico Marco';

const RESOLUTION = 'Resolución N.° 4916';

const JURISDICTION = 'Provincia de Corrientes';

// Tamaño máximo aproximado de cada chunk.
//
// No es un corte rígido:
// primero intentamos respetar artículos,
// incisos y párrafos.
const MAX_CHUNK_LENGTH = 1800;

// =====================================================
// TIPOS
// =====================================================

interface RamArticle {
  article: number;

  chapter: string | null;

  section: string | null;

  paragraphs: string[];
}

interface RamChunk {
  id: string;

  sourceId: string;

  document: string;

  resolution: string;

  jurisdiction: string;

  chapter: string | null;

  section: string | null;

  article: number;

  inciso: string | null;

  chunkIndex: number;

  text: string;

  type: 'normativa';
}

// =====================================================
// ENCABEZADOS CONOCIDOS DE LA RAM
// =====================================================

const KNOWN_SECTIONS = new Set([
  'Definición',
  'Del Ámbito de Aplicación',
  'Del Régimen Académico Institucional',

  'De las condiciones de ingreso',

  'Permanencia',

  'Promoción',

  'De los Regímenes de Promoción',

  'De los Exámenes Finales',

  'Inscripción',

  'Conformación de las mesas',

  'Del Reconocimiento de Unidades Curriculares por Equivalencia.',

  'De las condiciones para solicitar equivalencias',

  'De los estudiantes que ingresen por pase',

  'De la Adscripción',

  'Adscripción a las Unidades Curriculares',

  'Consideraciones generales',

  'Condiciones para el acceso a la Adscripción a las Unidades Curriculares',

  'Adscripción a las Coordinaciones de Área y Coordinaciones de Carrera.',

  'Condiciones para el acceso a la Adscripción a las Coordinaciones de Área y/o Coordinaciones de Carrera',

  'Requisitos Generales de Promoción',
]);

// =====================================================
// NORMALIZACIÓN
// =====================================================

function normalizeText(text: string): string {
  return text

    // Caracteres extraños provenientes del documento.
    .replace(/\u00ad/g, '')
    .replace(/￾/g, '')

    // Normalizar saltos de línea.
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')

    // Eliminar espacios antes de saltos.
    .replace(/[ \t]+\n/g, '\n')

    // Evitar más de dos saltos consecutivos.
    .replace(/\n{3,}/g, '\n\n')

    .trim();
}

// =====================================================
// EXTRAER SOLO EL ANEXO RAM
// =====================================================

function extractRamAnnex(text: string): string {
  const annexPatterns = [
    /ANEXO\s*\n\s*RÉGIMEN ACADÉMICO MARCO\s*\(RAM\)/i,

    /RÉGIMEN ACADÉMICO MARCO\s*\(RAM\)/i,
  ];

  let startIndex = -1;

  for (const pattern of annexPatterns) {
    const match = text.match(pattern);

    if (match && match.index !== undefined) {
      startIndex = match.index + match[0].length;
      break;
    }
  }

  if (startIndex === -1) {
    throw new Error(
      '❌ No se encontró el comienzo del ANEXO RÉGIMEN ACADÉMICO MARCO.'
    );
  }

  let annex = text.slice(startIndex);

  /*
   * La transcripción termina con una nota editorial
   * que describe el documento físico.
   *
   * No queremos embebir esa nota.
   */

  const endMarker =
    'Documento con firma ológrafa';

  const endIndex = annex.indexOf(endMarker);

  if (endIndex !== -1) {
    annex = annex.slice(0, endIndex);
  }

  return annex.trim();
}

// =====================================================
// UTILIDADES DE DETECCIÓN
// =====================================================

function isChapter(line: string): boolean {
  return /^Capítulo\b/i.test(line);
}

function cleanChapter(line: string): string {
  return line
    .replace(/^Capítulo\s*/i, '')
    .replace(/^[0-9IVXLC]+\s*[—\-:]?\s*/i, '')
    .trim();
}

function parseArticleStart(
  line: string
): {
  article: number;
  initialText: string;
} | null {

  const match = line.match(
    /^Artículo\s+(\d+)[°º]?\.?\s*(.*)$/i
  );

  if (!match) {
    return null;
  }

  return {
    article: Number(match[1]),

    initialText:
      match[2]?.trim() || '',
  };
}

function normalizeHeading(
  line: string
): string {

  return line
    .replace(/\s+/g, ' ')
    .trim();
}

function isKnownSection(
  line: string
): boolean {

  const normalized =
    normalizeHeading(line);

  return KNOWN_SECTIONS.has(normalized);
}

// =====================================================
// PARSEAR ARTÍCULOS
// =====================================================

function parseArticles(
  annexText: string
): RamArticle[] {

  const rawLines =
    annexText.split('\n');

  const lines =
    rawLines
      .map((line) => line.trim())
      .filter(Boolean);

  const articles: RamArticle[] = [];

  let currentChapter:
    string | null = null;

  let currentSection:
    string | null = null;

  let currentArticle:
    RamArticle | null = null;

  function saveCurrentArticle() {

    if (!currentArticle) {
      return;
    }

    currentArticle.paragraphs =
      currentArticle.paragraphs
        .map((paragraph) =>
          paragraph
            .replace(/\s+/g, ' ')
            .trim()
        )
        .filter(Boolean);

    articles.push(currentArticle);

    currentArticle = null;
  }

  for (const line of lines) {

    // -----------------------------------------------
    // CAPÍTULO
    // -----------------------------------------------

    if (isChapter(line)) {

      saveCurrentArticle();

      currentChapter =
        cleanChapter(line);

      currentSection = null;

      continue;
    }

    // -----------------------------------------------
    // SECCIÓN
    // -----------------------------------------------

    if (isKnownSection(line)) {

      if (
        currentArticle &&
        currentArticle.paragraphs.length > 0
      ) {

        saveCurrentArticle();
      }

      currentSection =
        normalizeHeading(line);

      continue;
    }

    // -----------------------------------------------
    // ARTÍCULO
    // -----------------------------------------------

    const articleStart =
      parseArticleStart(line);

    if (articleStart) {

      saveCurrentArticle();

      currentArticle = {
        article:
          articleStart.article,

        chapter:
          currentChapter,

        section:
          currentSection,

        paragraphs: [],
      };

      if (articleStart.initialText) {

        currentArticle.paragraphs.push(
          articleStart.initialText
        );
      }

      continue;
    }

    // -----------------------------------------------
    // TEXTO DENTRO DE ARTÍCULO
    // -----------------------------------------------

    if (currentArticle) {

      currentArticle.paragraphs.push(
        line
      );
    }
  }

  saveCurrentArticle();

  return articles;
}

// =====================================================
// DETECTAR INCISO
// =====================================================

function detectInciso(
  paragraph: string
): string | null {

  const match =
    paragraph.match(
      /^([a-z])\)\s+/i
    );

  if (!match) {
    return null;
  }

  return match[1].toLowerCase();
}

// =====================================================
// DIVIDIR ARTÍCULO EN CHUNKS
// =====================================================

function splitArticleIntoChunks(
  article: RamArticle
): RamChunk[] {

  const chunks: RamChunk[] = [];

  let buffer: string[] = [];

  let currentInciso:
    string | null = null;

  let chunkIndex = 1;

  function saveBuffer() {

    if (buffer.length === 0) {
      return;
    }

    const text =
      buffer
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!text) {
      buffer = [];
      return;
    }

    const paddedIndex =
      String(chunkIndex)
        .padStart(2, '0');

    chunks.push({
      id:
        `ram-4916-art-${article.article}-${paddedIndex}`,

      sourceId:
        SOURCE_ID,

      document:
        DOCUMENT_NAME,

      resolution:
        RESOLUTION,

      jurisdiction:
        JURISDICTION,

      chapter:
        article.chapter,

      section:
        article.section,

      article:
        article.article,

      inciso:
        currentInciso,

      chunkIndex,

      text,

      type:
        'normativa',
    });

    chunkIndex++;

    buffer = [];
  }

  for (
    const paragraph
    of article.paragraphs
  ) {

    const inciso =
      detectInciso(paragraph);

    /*
     * Si encontramos un nuevo inciso
     * y ya tenemos bastante contenido,
     * cerramos el chunk anterior.
     */

    if (
      inciso &&
      buffer.length > 0
    ) {

      saveBuffer();

      currentInciso =
        inciso;
    } else if (inciso) {

      currentInciso =
        inciso;
    }

    const currentLength =
      buffer.join(' ').length;

    const nextLength =
      currentLength +
      paragraph.length;

    /*
     * Si superaríamos el tamaño máximo,
     * guardamos primero lo acumulado.
     */

    if (
      nextLength >
        MAX_CHUNK_LENGTH &&
      buffer.length > 0
    ) {

      saveBuffer();
    }

    buffer.push(
      paragraph
    );
  }

  saveBuffer();

  return chunks;
}

// =====================================================
// VALIDACIONES
// =====================================================

function validateArticles(
  articles: RamArticle[]
): void {

  if (articles.length === 0) {
    throw new Error(
      '❌ No se detectaron artículos.'
    );
  }

  const articleNumbers =
    articles.map(
      (article) =>
        article.article
    );

  const first =
    Math.min(
      ...articleNumbers
    );

  const last =
    Math.max(
      ...articleNumbers
    );

  console.log(
    `📚 Artículos detectados: ${articles.length}`
  );

  console.log(
    `📖 Rango detectado: Artículo ${first} → Artículo ${last}`
  );

  /*
   * Nuestra RAM debería contener
   * artículos del 1 al 53.
   */

  const missing: number[] = [];

  for (
    let number = 1;
    number <= 53;
    number++
  ) {

    if (
      !articleNumbers.includes(
        number
      )
    ) {

      missing.push(
        number
      );
    }
  }

  if (missing.length > 0) {

    console.warn(
      '⚠️ Artículos no detectados:',
      missing.join(', ')
    );

  } else {

    console.log(
      '✅ Se detectaron los artículos 1 al 53.'
    );
  }
}

// =====================================================
// PROCESO PRINCIPAL
// =====================================================

async function processRam() {

  try {

    console.log(
      '🚀 Iniciando procesamiento de la RAM...'
    );

    console.log(
      `📄 Archivo fuente: ${SOURCE_FILE}`
    );

    // -----------------------------------------------
    // 1. Verificar archivo
    // -----------------------------------------------

    if (
      !fs.existsSync(
        SOURCE_FILE
      )
    ) {

      throw new Error(
        `No existe el archivo:\n${SOURCE_FILE}`
      );
    }

    // -----------------------------------------------
    // 2. Leer DOCX
    // -----------------------------------------------

    console.log(
      '📖 Extrayendo texto del DOCX...'
    );

    const result =
      await mammoth.extractRawText({
        path:
          SOURCE_FILE,
      });

    if (
      result.messages.length > 0
    ) {

      console.log(
        'ℹ️ Mensajes de Mammoth:'
      );

      for (
        const message
        of result.messages
      ) {

        console.log(
          `   - ${message.message}`
        );
      }
    }

    // -----------------------------------------------
    // 3. Normalizar
    // -----------------------------------------------

    const normalizedText =
      normalizeText(
        result.value
      );

    console.log(
      `✅ Texto extraído: ${normalizedText.length} caracteres`
    );

    // -----------------------------------------------
    // 4. Extraer ANEXO
    // -----------------------------------------------

    const annex =
      extractRamAnnex(
        normalizedText
      );

    console.log(
      `✅ ANEXO RAM aislado: ${annex.length} caracteres`
    );

    // -----------------------------------------------
    // 5. Detectar artículos
    // -----------------------------------------------

    const articles =
      parseArticles(
        annex
      );

    validateArticles(
      articles
    );

    // -----------------------------------------------
    // 6. Crear chunks
    // -----------------------------------------------

    const chunks =
      articles.flatMap(
        (article) =>
          splitArticleIntoChunks(
            article
          )
      );

    console.log(
      `🧩 Chunks generados: ${chunks.length}`
    );

    // -----------------------------------------------
    // 7. Estadísticas
    // -----------------------------------------------

    const lengths =
      chunks.map(
        (chunk) =>
          chunk.text.length
      );

    const shortest =
      Math.min(
        ...lengths
      );

    const longest =
      Math.max(
        ...lengths
      );

    const average =
      Math.round(
        lengths.reduce(
          (sum, value) =>
            sum + value,
          0
        ) /
          lengths.length
      );

    console.log(
      `📏 Chunk más corto: ${shortest} caracteres`
    );

    console.log(
      `📏 Chunk más largo: ${longest} caracteres`
    );

    console.log(
      `📏 Promedio: ${average} caracteres`
    );

    // -----------------------------------------------
    // 8. Guardar JSON
    // -----------------------------------------------

    const output = {
      metadata: {

        sourceId:
          SOURCE_ID,

        document:
          DOCUMENT_NAME,

        resolution:
          RESOLUTION,

        jurisdiction:
          JURISDICTION,

        generatedAt:
          new Date()
            .toISOString(),

        totalArticles:
          articles.length,

        totalChunks:
          chunks.length,
      },

      chunks,
    };

    fs.writeFileSync(
      OUTPUT_FILE,

      JSON.stringify(
        output,
        null,
        2
      ),

      'utf-8'
    );

    console.log(
      '\n🎉 RAM procesada correctamente.'
    );

    console.log(
      `📦 Archivo generado:\n${OUTPUT_FILE}`
    );

  } catch (
    error: any
  ) {

    console.error(
      '\n🔥 Error procesando la RAM:'
    );

    console.error(
      error?.message ||
        error
    );

    process.exitCode = 1;
  }
}

processRam();