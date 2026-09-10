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

const OUTPUT_DIRECTORY = path.join(
  process.cwd(),
  'data',
  'processed'
);

const OUTPUT_FILE = path.join(
  OUTPUT_DIRECTORY,
  'ram_chunks.json'
);

const SOURCE_ID =
  'ram-res-4916-2025';

const DOCUMENT_NAME =
  'Régimen Académico Marco';

const RESOLUTION =
  'Resolución N.° 4916';

const JURISDICTION =
  'Provincia de Corrientes';

/*
 * Tamaños preferidos.
 *
 * Un artículo que no supera MAX_CHUNK_LENGTH
 * se conserva completo.
 *
 * Sólo los artículos largos se dividen.
 */
const MIN_CHUNK_LENGTH = 250;

const MAX_CHUNK_LENGTH = 1600;

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

interface ChunkStatistics {
  total: number;

  shortest: number;

  longest: number;

  average: number;

  under100: number;

  under200: number;
}

// =====================================================
// ENCABEZADOS CONOCIDOS
// =====================================================

/*
 * Incluye tanto secciones generales
 * como subtítulos internos.
 *
 * Detectarlos nos permite conservar la
 * estructura semántica del documento.
 */
const KNOWN_HEADINGS = new Set([
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

  'Del Reconocimiento de Unidades Curriculares por Equivalencia',

  'De las condiciones para solicitar equivalencias',

  'De los estudiantes que ingresen por pase',

  'De la Adscripción',

  'Adscripción a las Unidades Curriculares',

  'Consideraciones generales',

  'Condiciones para el acceso a la Adscripción a las Unidades Curriculares',

  'Adscripción a las Coordinaciones de Área y Coordinaciones de Carrera.',

  'Adscripción a las Coordinaciones de Área y Coordinaciones de Carrera',

  'Condiciones para el acceso a la Adscripción a las Coordinaciones de Área y/o Coordinaciones de Carrera',

  'Requisitos Generales de Promoción',
]);

// =====================================================
// SECCIONES PRINCIPALES
// =====================================================

/*
 * Estas sí modifican el contexto de los
 * artículos siguientes.
 *
 * En cambio, encabezados como
 * "Consideraciones generales" pueden ser
 * subtítulos internos y no necesariamente
 * deben reemplazar la sección principal.
 */
const MAIN_SECTION_HEADINGS = new Set([
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

  'Del Reconocimiento de Unidades Curriculares por Equivalencia',

  'De las condiciones para solicitar equivalencias',

  'De los estudiantes que ingresen por pase',

  'De la Adscripción',
]);

// =====================================================
// INICIO CONOCIDO DE ALGUNAS SECCIONES
// =====================================================

/*
 * Esta tabla funciona como respaldo.
 *
 * Cuando sabemos que determinado artículo
 * comienza una sección, actualizamos el contexto
 * aunque el DOCX haya colocado visualmente el
 * encabezado junto al artículo anterior.
 *
 * Las secciones posteriores heredarán este valor
 * hasta encontrar otra sección principal.
 */
const ARTICLE_SECTION_STARTS:
  Record<number, string> = {

  1:
    'Definición',

  2:
    'Del Ámbito de Aplicación',

  3:
    'Del Régimen Académico Institucional',

  4:
    'De las condiciones de ingreso',

  10:
    'Permanencia',

  17:
    'De los Regímenes de Promoción',

  23:
    'De los Exámenes Finales',

  25:
    'Inscripción',

  26:
    'Conformación de las mesas',

  31:
    'Del Reconocimiento de Unidades Curriculares por Equivalencia',

  36:
    'De las condiciones para solicitar equivalencias',

  42:
    'De los estudiantes que ingresen por pase',

  45:
    'De la Adscripción',
};

// =====================================================
// NORMALIZACIÓN GENERAL
// =====================================================

function normalizeText(
  text: string
): string {

  return text

    /*
     * Caracteres invisibles o extraños
     * provenientes del DOCX.
     */
    .replace(
      /\u00ad/g,
      ''
    )

    .replace(
      /￾/g,
      ''
    )

    /*
     * Normalizar saltos.
     */
    .replace(
      /\r\n/g,
      '\n'
    )

    .replace(
      /\r/g,
      '\n'
    )

    /*
     * Espacios antes de saltos.
     */
    .replace(
      /[ \t]+\n/g,
      '\n'
    )

    /*
     * Evitar demasiados saltos consecutivos.
     */
    .replace(
      /\n{3,}/g,
      '\n\n'
    )

    /*
     * Correcciones puntuales verificadas
     * de errores introducidos durante
     * la extracción del DOCX.
     *
     * No hacemos correcciones generales
     * que pudieran modificar la normativa.
     */
    .replace(
      /Buenod\)/g,
      'Bueno d)'
    )

    .replace(
      /carrera,no/g,
      'carrera, no'
    )

    .replace(
      /latitulación/g,
      'la titulación'
    )

    .replace(
      /Generalde/g,
      'General de'
    )

    .replace(
      /firmadoen/g,
      'firmado en'
    )

    /*
     * Separador editorial al final
     * del documento.
     */
    .replace(
      /\*\s*\*\s*\*/g,
      ''
    )

    .trim();
}

// =====================================================
// NORMALIZACIÓN FINAL DE CHUNKS
// =====================================================

function normalizeChunkText(
  text: string
): string {

  return text

    // Espacios generales.
    .replace(
      /\s+/g,
      ' '
    )

    // Correcciones verificadas de extracción.
    .replace(
      /Buenod\)/g,
      'Bueno d)'
    )

    .replace(
      /carrera,no/g,
      'carrera, no'
    )

    .replace(
      /latitulación/g,
      'la titulación'
    )

    .replace(
      /Generalde/g,
      'General de'
    )

    .replace(
      /firmadoen/g,
      'firmado en'
    )

    // Encabezado detectado sin espacio.
    .replace(
      /solicitarequivalencias/gi,
      'solicitar equivalencias'
    )

    // Separadores editoriales.
    .replace(
      /\*\s*\*\s*\*/g,
      ''
    )

    .trim();
}

// =====================================================
// EXTRAER SOLAMENTE EL ANEXO RAM
// =====================================================

function extractRamAnnex(
  text: string
): string {

  const patterns = [
    /ANEXO\s*\n\s*RÉGIMEN ACADÉMICO MARCO\s*\(RAM\)/i,

    /RÉGIMEN ACADÉMICO MARCO\s*\(RAM\)/i,
  ];

  let startIndex = -1;

  for (
    const pattern
    of patterns
  ) {

    const match =
      text.match(
        pattern
      );

    if (
      match &&
      match.index !== undefined
    ) {

      startIndex =
        match.index +
        match[0].length;

      break;
    }
  }

  if (
    startIndex === -1
  ) {

    throw new Error(
      '❌ No se encontró el comienzo del ANEXO RAM.'
    );
  }

  let annex =
    text.slice(
      startIndex
    );

  /*
   * La transcripción contiene al final
   * una nota editorial acerca del documento
   * físico.
   *
   * No forma parte del contenido que queremos
   * enviar al RAG.
   */
  const endMarker =
    'Documento con firma ológrafa';

  const endIndex =
    annex.indexOf(
      endMarker
    );

  if (
    endIndex !== -1
  ) {

    annex =
      annex.slice(
        0,
        endIndex
      );
  }

  return annex.trim();
}

// =====================================================
// NORMALIZAR ENCABEZADOS
// =====================================================

function normalizeHeading(
  line: string
): string {

  return line

    .replace(
      /\s+/g,
      ' '
    )

    .replace(
      /solicitarequivalencias/gi,
      'solicitar equivalencias'
    )

    .trim();
}

// =====================================================
// DETECTAR ENCABEZADO
// =====================================================

function isKnownHeading(
  line: string
): boolean {

  return KNOWN_HEADINGS.has(
    normalizeHeading(
      line
    )
  );
}

// =====================================================
// DETECTAR SECCIÓN PRINCIPAL
// =====================================================

function isMainSectionHeading(
  line: string
): boolean {

  return MAIN_SECTION_HEADINGS.has(
    normalizeHeading(
      line
    )
  );
}

// =====================================================
// DETECTAR CAPÍTULO
// =====================================================

function isChapter(
  line: string
): boolean {

  return /^Capítulo\b/i.test(
    line
  );
}

// =====================================================
// LIMPIAR NOMBRE DE CAPÍTULO
// =====================================================

function cleanChapter(
  line: string
): string {

  return line

    .replace(
      /^Capítulo\s*/i,
      ''
    )

    .replace(
      /^[0-9IVXLC]+\s*[—\-:]?\s*/i,
      ''
    )

    .trim();
}

// =====================================================
// DETECTAR INICIO DE ARTÍCULO
// =====================================================

function parseArticleStart(
  line: string
): {
  article: number;
  initialText: string;
} | null {

  const match =
    line.match(
      /^Artículo\s+(\d+)[°º]?\.?\s*(.*)$/i
    );

  if (
    !match
  ) {

    return null;
  }

  return {
    article:
      Number(
        match[1]
      ),

    initialText:
      match[2]
        ?.trim() ||
      '',
  };
}

// =====================================================
// PARSEAR ARTÍCULOS
// =====================================================

function parseArticles(
  annexText: string
): RamArticle[] {

  const lines =
    annexText

      .split(
        '\n'
      )

      .map(
        (line) =>
          line.trim()
      )

      .filter(
        Boolean
      );

  const articles:
    RamArticle[] = [];

  let currentChapter:
    string | null = null;

  let currentSection:
    string | null = null;

  /*
   * Si encontramos un encabezado mientras
   * todavía está abierto el artículo anterior,
   * puede representar la sección del próximo.
   *
   * Lo guardamos acá hasta que aparezca
   * el siguiente "Artículo X".
   */
  let pendingSection:
    string | null = null;

  let currentArticle:
    RamArticle | null = null;

  // ---------------------------------------------------
  // Guardar artículo actual
  // ---------------------------------------------------

  function saveCurrentArticle():
    void {

    if (
      !currentArticle
    ) {

      return;
    }

    currentArticle.paragraphs =
      currentArticle
        .paragraphs

        .map(
          (
            paragraph
          ) =>
            paragraph

              .replace(
                /\s+/g,
                ' '
              )

              .trim()
        )

        .filter(
          Boolean
        );

    articles.push(
      currentArticle
    );

    currentArticle =
      null;
  }

  // ---------------------------------------------------
  // Recorrer documento
  // ---------------------------------------------------

  for (
    const line
    of lines
  ) {

    // =================================================
    // 1. NUEVO ARTÍCULO
    // =================================================

    const articleStart =
      parseArticleStart(
        line
      );

    if (
      articleStart
    ) {

      /*
       * El nuevo artículo termina
       * definitivamente el anterior.
       */
      saveCurrentArticle();

      /*
       * Si tenemos una sección explícitamente
       * asociada al comienzo de este artículo,
       * tiene prioridad.
       */
      const explicitSection =
        ARTICLE_SECTION_STARTS[
          articleStart.article
        ];

      if (
        explicitSection
      ) {

        currentSection =
          explicitSection;

        pendingSection =
          null;

      } else if (
        pendingSection
      ) {

        /*
         * Encabezado encontrado justo antes
         * del nuevo artículo.
         */
        currentSection =
          pendingSection;

        pendingSection =
          null;
      }

      currentArticle = {
        article:
          articleStart.article,

        chapter:
          currentChapter,

        section:
          currentSection,

        paragraphs: [],
      };

      if (
        articleStart
          .initialText
      ) {

        currentArticle
          .paragraphs
          .push(
            articleStart
              .initialText
          );
      }

      continue;
    }

    // =================================================
    // 2. CAPÍTULO
    // =================================================

    if (
      isChapter(
        line
      )
    ) {

      /*
       * Un capítulo comienza entre artículos.
       */
      if (
        currentArticle
      ) {

        saveCurrentArticle();
      }

      currentChapter =
        cleanChapter(
          line
        );

      currentSection =
        null;

      pendingSection =
        null;

      continue;
    }

    // =================================================
    // 3. ENCABEZADO CONOCIDO
    // =================================================

    if (
      isKnownHeading(
        line
      )
    ) {

      const heading =
        normalizeHeading(
          line
        );

      /*
       * Caso A:
       * estamos fuera de un artículo.
       *
       * Entonces el encabezado define directamente
       * la sección siguiente.
       */
      if (
        !currentArticle
      ) {

        if (
          isMainSectionHeading(
            heading
          )
        ) {

          currentSection =
            heading;
        }

        continue;
      }

      /*
       * Caso B:
       * estamos dentro de un artículo.
       *
       * Conservamos siempre el encabezado
       * como texto porque puede ser un
       * subtítulo interno del artículo.
       */
      currentArticle
        .paragraphs
        .push(
          heading
        );

      /*
       * Si además es una sección principal,
       * puede ser el encabezado de la sección
       * que comienza en el artículo siguiente.
       *
       * No modificamos la sección del artículo
       * actual.
       */
      if (
        isMainSectionHeading(
          heading
        )
      ) {

        pendingSection =
          heading;
      }

      continue;
    }

    // =================================================
    // 4. TEXTO NORMAL DEL ARTÍCULO
    // =================================================

    if (
      currentArticle
    ) {

      currentArticle
        .paragraphs
        .push(
          line
        );

      continue;
    }

    /*
     * El texto que aparezca fuera de artículos
     * y no sea un encabezado reconocido
     * no se genera como vector independiente.
     */
  }

  // ---------------------------------------------------
  // Último artículo
  // ---------------------------------------------------

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

  if (
    !match
  ) {

    return null;
  }

  return match[1]
    .toLowerCase();
}

// =====================================================
// CONSTRUIR TEXTO DE CHUNK
// =====================================================

function buildChunkText(
  paragraphs: string[]
): string {

  const text =
    paragraphs.join(' ');

  return normalizeChunkText(
    text
  );
}

// =====================================================
// CREAR CHUNK
// =====================================================

function createChunk(
  article: RamArticle,
  chunkIndex: number,
  text: string,
  inciso: string | null
): RamChunk {

  return {
    id:
      `ram-4916-art-${article.article}-${String(
        chunkIndex
      ).padStart(
        2,
        '0'
      )}`,

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

    inciso,

    chunkIndex,

    text,

    type:
      'normativa',
  };
}

// =====================================================
// DIVIDIR ARTÍCULO EN CHUNKS
// =====================================================

function splitArticleIntoChunks(
  article: RamArticle
): RamChunk[] {

  const chunks:
    RamChunk[] = [];

  const completeText =
    buildChunkText(
      article.paragraphs
    );

  /*
   * Si todo el artículo cabe en un chunk,
   * conservamos el artículo completo.
   */
  if (
    completeText.length <=
    MAX_CHUNK_LENGTH
  ) {

    chunks.push(
      createChunk(
        article,
        1,
        completeText,
        null
      )
    );

    return chunks;
  }

  // ---------------------------------------------------
  // Artículo largo
  // ---------------------------------------------------

  let buffer:
    string[] = [];

  let bufferIncisos =
    new Set<string>();

  let chunkIndex =
    1;

  // ---------------------------------------------------
  // Guardar buffer actual
  // ---------------------------------------------------

  function saveBuffer():
    void {

    if (
      buffer.length === 0
    ) {

      return;
    }

    const text =
      buildChunkText(
        buffer
      );

    if (
      !text
    ) {

      buffer = [];

      bufferIncisos =
        new Set();

      return;
    }

    /*
     * Sólo ponemos un inciso concreto cuando
     * TODO el chunk corresponde claramente
     * a un único inciso.
     */
    const inciso =
      bufferIncisos.size ===
      1

        ? Array.from(
            bufferIncisos
          )[0]

        : null;

    chunks.push(
      createChunk(
        article,
        chunkIndex,
        text,
        inciso
      )
    );

    chunkIndex++;

    buffer = [];

    bufferIncisos =
      new Set();
  }

  // ---------------------------------------------------
  // Recorrer párrafos
  // ---------------------------------------------------

  for (
    const paragraph
    of article.paragraphs
  ) {

    const inciso =
      detectInciso(
        paragraph
      );

    const currentLength =
      buildChunkText(
        buffer
      ).length;

    const separatorLength =
      buffer.length > 0
        ? 1
        : 0;

    const proposedLength =
      currentLength +
      separatorLength +
      paragraph.length;

    /*
     * Cortamos solamente cuando agregar
     * el nuevo párrafo superaría el máximo.
     */
    if (
      proposedLength >
        MAX_CHUNK_LENGTH &&
      buffer.length > 0
    ) {

      saveBuffer();
    }

    buffer.push(
      paragraph
    );

    if (
      inciso
    ) {

      bufferIncisos.add(
        inciso
      );
    }
  }

  saveBuffer();

  /*
   * Si el último fragmento quedó demasiado
   * pequeño, intentamos incorporarlo al anterior.
   */
  return mergeLastSmallChunk(
    chunks
  );
}

// =====================================================
// FUSIONAR ÚLTIMO CHUNK PEQUEÑO
// =====================================================

function mergeLastSmallChunk(
  chunks: RamChunk[]
): RamChunk[] {

  if (
    chunks.length < 2
  ) {

    return chunks;
  }

  const last =
    chunks[
      chunks.length - 1
    ];

  const previous =
    chunks[
      chunks.length - 2
    ];

  /*
   * Ya tiene tamaño razonable.
   */
  if (
    last.text.length >=
    MIN_CHUNK_LENGTH
  ) {

    return chunks;
  }

  const combined =
    `${previous.text} ${last.text}`

      .replace(
        /\s+/g,
        ' '
      )

      .trim();

  /*
   * Permitimos un margen de 300 caracteres
   * para evitar dejar un fragmento semánticamente
   * pobre por separado.
   */
  if (
    combined.length <=
    MAX_CHUNK_LENGTH +
      300
  ) {

    previous.text =
      combined;

    previous.inciso =
      null;

    chunks.pop();
  }

  return reindexChunks(
    chunks
  );
}

// =====================================================
// REINDEXAR CHUNKS
// =====================================================

function reindexChunks(
  chunks: RamChunk[]
): RamChunk[] {

  return chunks.map(
    (
      chunk,
      index
    ) => {

      const nextIndex =
        index + 1;

      return {
        ...chunk,

        chunkIndex:
          nextIndex,

        id:
          `ram-4916-art-${chunk.article}-${String(
            nextIndex
          ).padStart(
            2,
            '0'
          )}`,
      };
    }
  );
}

// =====================================================
// VALIDAR ARTÍCULOS 1–53
// =====================================================

function validateArticles(
  articles: RamArticle[]
): void {

  if (
    articles.length ===
    0
  ) {

    throw new Error(
      '❌ No se detectaron artículos.'
    );
  }

  const articleNumbers =
    articles.map(
      (
        article
      ) =>
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

  const missing:
    number[] = [];

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

  if (
    missing.length >
    0
  ) {

    throw new Error(
      `❌ Faltan artículos: ${missing.join(
        ', '
      )}`
    );
  }

  console.log(
    '✅ Se detectaron los artículos 1 al 53.'
  );
}

// =====================================================
// CALCULAR ESTADÍSTICAS
// =====================================================

function calculateStatistics(
  chunks: RamChunk[]
): ChunkStatistics {

  if (
    chunks.length ===
    0
  ) {

    return {
      total:
        0,

      shortest:
        0,

      longest:
        0,

      average:
        0,

      under100:
        0,

      under200:
        0,
    };
  }

  const lengths =
    chunks.map(
      (
        chunk
      ) =>
        chunk.text.length
    );

  const totalCharacters =
    lengths.reduce(
      (
        sum,
        value
      ) =>
        sum +
        value,
      0
    );

  return {
    total:
      chunks.length,

    shortest:
      Math.min(
        ...lengths
      ),

    longest:
      Math.max(
        ...lengths
      ),

    average:
      Math.round(
        totalCharacters /
        chunks.length
      ),

    under100:
      chunks.filter(
        (
          chunk
        ) =>
          chunk.text.length <
          100
      ).length,

    under200:
      chunks.filter(
        (
          chunk
        ) =>
          chunk.text.length <
          200
      ).length,
  };
}

// =====================================================
// IMPRIMIR ESTADÍSTICAS
// =====================================================

function printStatistics(
  stats: ChunkStatistics
): void {

  console.log(
    '\n📊 RESULTADO FINAL'
  );

  console.log(
    `🧩 Total: ${stats.total}`
  );

  console.log(
    `📏 Chunk más corto: ${stats.shortest} caracteres`
  );

  console.log(
    `📏 Chunk más largo: ${stats.longest} caracteres`
  );

  console.log(
    `📏 Promedio: ${stats.average} caracteres`
  );

  console.log(
    `🔹 Menores a 100 caracteres: ${stats.under100}`
  );

  console.log(
    `🔸 Menores a 200 caracteres: ${stats.under200}`
  );
}

// =====================================================
// VALIDAR ARTÍCULOS IMPORTANTES
// =====================================================

function validateImportantArticles(
  chunks: RamChunk[]
): void {

  const importantArticles = [
    4,
    12,
    17,
    18,
    19,
    21,
    25,
    36,
    39,
    45,
    46,
    47,
    48,
    50,
    53,
  ];

  console.log(
    '\n🔎 Validando artículos importantes...'
  );

  for (
    const article
    of importantArticles
  ) {

    const matches =
      chunks.filter(
        (
          chunk
        ) =>
          chunk.article ===
          article
      );

    const characterCount =
      matches.reduce(
        (
          sum,
          chunk
        ) =>
          sum +
          chunk.text.length,
        0
      );

    const section =
      matches[0]
        ?.section ??
      '-';

    console.log(
      `✅ Art. ${article}: ${matches.length} chunk(s), ${characterCount} caracteres, sección: ${section}`
    );
  }
}

// =====================================================
// VALIDAR METADATA DE SECCIONES
// =====================================================

function validateSectionMetadata(
  chunks: RamChunk[]
): void {

  const expected = [
    {
      article:
        12,

      section:
        'Permanencia',
    },

    {
      article:
        36,

      section:
        'De las condiciones para solicitar equivalencias',
    },

    {
      article:
        45,

      section:
        'De la Adscripción',
    },
  ];

  console.log(
    '\n🏷️ Validando metadata de secciones...'
  );

  for (
    const test
    of expected
  ) {

    const chunk =
      chunks.find(
        (
          item
        ) =>
          item.article ===
          test.article
      );

    if (
      !chunk
    ) {

      console.warn(
        `⚠️ No se encontró el artículo ${test.article}.`
      );

      continue;
    }

    if (
      chunk.section ===
      test.section
    ) {

      console.log(
        `✅ Art. ${test.article} → ${chunk.section}`
      );

    } else {

      console.warn(
        `⚠️ Art. ${test.article}: sección esperada "${test.section}", obtenida "${chunk.section ?? '-'}"`
      );
    }
  }
}

// =====================================================
// BUSCAR ARTEFACTOS CONOCIDOS
// =====================================================

function validateExtractionArtifacts(
  chunks: RamChunk[]
): void {

  const suspiciousPatterns = [
    'Buenod)',
    'carrera,no',
    'latitulación',
    'Generalde',
    'firmadoen',
    '* * *',
  ];

  console.log(
    '\n🧹 Validando artefactos de extracción...'
  );

  let found =
    0;

  for (
    const chunk
    of chunks
  ) {

    for (
      const pattern
      of suspiciousPatterns
    ) {

      if (
        chunk.text.includes(
          pattern
        )
      ) {

        found++;

        console.warn(
          `⚠️ ${chunk.id}: se encontró "${pattern}"`
        );
      }
    }
  }

  if (
    found === 0
  ) {

    console.log(
      '✅ No se encontraron los artefactos conocidos.'
    );
  }
}

// =====================================================
// PROCESO PRINCIPAL
// =====================================================

async function processRam():
  Promise<void> {

  try {

    console.log(
      '🚀 Iniciando procesamiento de la RAM...'
    );

    console.log(
      `📄 Archivo fuente: ${SOURCE_FILE}`
    );

    // -------------------------------------------------
    // 1. Comprobar archivo fuente
    // -------------------------------------------------

    if (
      !fs.existsSync(
        SOURCE_FILE
      )
    ) {

      throw new Error(
        `❌ No existe el archivo:\n${SOURCE_FILE}`
      );
    }

    // -------------------------------------------------
    // 2. Crear directorio de salida
    // -------------------------------------------------

    fs.mkdirSync(
      OUTPUT_DIRECTORY,
      {
        recursive:
          true,
      }
    );

    // -------------------------------------------------
    // 3. Extraer texto del DOCX
    // -------------------------------------------------

    console.log(
      '📖 Extrayendo texto del DOCX...'
    );

    const result =
      await mammoth
        .extractRawText({
          path:
            SOURCE_FILE,
        });

    if (
      result.messages.length >
      0
    ) {

      console.log(
        'ℹ️ Mammoth generó mensajes durante la extracción:'
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

    // -------------------------------------------------
    // 4. Normalizar
    // -------------------------------------------------

    const normalizedText =
      normalizeText(
        result.value
      );

    console.log(
      `✅ Texto extraído: ${normalizedText.length} caracteres`
    );

    // -------------------------------------------------
    // 5. Aislar ANEXO RAM
    // -------------------------------------------------

    const annex =
      extractRamAnnex(
        normalizedText
      );

    console.log(
      `✅ ANEXO RAM aislado: ${annex.length} caracteres`
    );

    // -------------------------------------------------
    // 6. Parsear artículos
    // -------------------------------------------------

    const articles =
      parseArticles(
        annex
      );

    validateArticles(
      articles
    );

    // -------------------------------------------------
    // 7. Generar chunks
    // -------------------------------------------------

    const chunks =
      articles.flatMap(
        (
          article
        ) =>
          splitArticleIntoChunks(
            article
          )
      );

    // -------------------------------------------------
    // 8. Estadísticas
    // -------------------------------------------------

    const statistics =
      calculateStatistics(
        chunks
      );

    printStatistics(
      statistics
    );

    // -------------------------------------------------
    // 9. Validar contenido importante
    // -------------------------------------------------

    validateImportantArticles(
      chunks
    );

    // -------------------------------------------------
    // 10. Validar secciones
    // -------------------------------------------------

    validateSectionMetadata(
      chunks
    );

    // -------------------------------------------------
    // 11. Validar errores conocidos de extracción
    // -------------------------------------------------

    validateExtractionArtifacts(
      chunks
    );

    // -------------------------------------------------
    // 12. Construir JSON
    // -------------------------------------------------

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

        chunkConfiguration: {

          minPreferredLength:
            MIN_CHUNK_LENGTH,

          maxPreferredLength:
            MAX_CHUNK_LENGTH,
        },

        statistics,
      },

      chunks,
    };

    // -------------------------------------------------
    // 13. Guardar archivo
    // -------------------------------------------------

    fs.writeFileSync(
      OUTPUT_FILE,

      JSON.stringify(
        output,
        null,
        2
      ),

      'utf-8'
    );

    // -------------------------------------------------
    // FINAL
    // -------------------------------------------------

    console.log(
      '\n🎉 RAM procesada correctamente.'
    );

    console.log(
      `📦 Archivo generado:\n${OUTPUT_FILE}`
    );

  } catch (
    error: unknown
  ) {

    console.error(
      '\n🔥 Error procesando la RAM:'
    );

    if (
      error instanceof
      Error
    ) {

      console.error(
        error.message
      );

    } else {

      console.error(
        error
      );
    }

    process.exitCode =
      1;
  }
}

processRam();