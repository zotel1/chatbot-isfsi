import fs from 'node:fs';
import path from 'node:path';
import mammoth from 'mammoth';
import { parse, HTMLElement, Node } from 'node-html-parser';

// =====================================================
// CONFIGURACIÓN
// =====================================================
// Sigue el mismo patrón que scripts/processRam.ts, pero
// adaptado a un documento que NO está organizado por
// "Artículo N°", sino por Anexos con secciones temáticas
// (prosa) y tablas de actividades por fecha.

const SOURCE_FILE = path.join(
  process.cwd(),
  'data',
  'source',
  'calendario',
  'calendario-escolar-2026-rm4706-25.docx'
);

const OUTPUT_DIRECTORY = path.join(process.cwd(), 'data', 'processed');

const OUTPUT_FILE = path.join(OUTPUT_DIRECTORY, 'calendario_chunks.json');

const SOURCE_ID = 'calendario-escolar-2026-rm4706-25';

const DOCUMENT_NAME = 'Calendario Escolar 2026';

const RESOLUTION = 'Resolución Ministerial N.° 4706/25';

const JURISDICTION = 'Provincia de Corrientes';

/*
 * Alcance de esta carga (decidido para el evento de Expo
 * de la carrera de Desarrollo de Software):
 *
 * SE INCLUYE:
 *   - Artículos 1 a 4 de la resolución.
 *   - Anexo I  (Disposiciones Generales, aplican a todos los niveles).
 *   - Anexo III (Nivel Superior: definiciones + cronograma mensual).
 *   - Anexo IV (Efemérides), agrupado por mes.
 *   - Anexo V  (Glosario de siglas).
 *
 * NO SE INCLUYE:
 *   - Anexo II (Inicial / Primario / Secundario / C.E.F.), no aplica
 *     a un Instituto de Educación Superior.
 */

const MIN_TOPIC_LENGTH = 120;

const MAX_TOPIC_LENGTH = 1600;

const MONTH_NAMES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

// =====================================================
// TIPOS
// =====================================================

interface OutputChunk {
  id: string;
  sourceId: string;
  document: string;
  resolution: string;
  jurisdiction: string;
  chapter: string | null;
  section: string | null;
  article: number | null;
  inciso: string | null;
  chunkIndex: number;
  kind: 'article' | 'section-intro';
  text: string;
  type: 'normativa';
}

interface TopicDraft {
  chapter: string | null;
  section: string;
  paragraphs: string[];
}

interface ActivityEntry {
  month: string | null;
  fecha: string;
  actividad: string;
  nivel: string | null;
}

// =====================================================
// UTILIDADES DE TEXTO
// =====================================================

function normalizeSpaces(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function chapterSlug(chapter: string | null): string {
  if (chapter === 'Anexo I - Disposiciones Generales') return 'anexo1';
  if (chapter === 'Anexo III - Nivel Superior') return 'anexo3';
  return 'topic';
}

function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);
}

function isMonthHeaderText(text: string): string | null {
  const normalized = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

  return MONTH_NAMES.includes(normalized) ? normalized : null;
}

function findMonthInText(text: string): string | null {
  const normalized = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

  for (const month of MONTH_NAMES) {
    if (normalized.includes(`de ${month}`)) {
      return month;
    }
  }

  return null;
}

/*
 * Algunas tablas de Efemérides (Anexo IV) no separan fecha y
 * descripción en dos columnas: vienen en una sola celda con el
 * formato "10 de junio: Día Nacional...". Esta función detecta
 * si una celda de una sola columna ES el inicio de una nueva
 * efeméride (devuelve fecha/mes/resto) o si, en cambio, es texto
 * envuelto que continúa la fila anterior (devuelve null).
 */
function parseSingleCellEfemeride(
  text: string
): { fecha: string; month: string; resto: string } | null {
  const match = text.match(
    /^(.{0,60}?\bde\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b[^:]{0,40}:)\s*(.*)$/i
  );

  if (!match) return null;

  return {
    fecha: match[1].trim(),
    month: match[2].toLowerCase(),
    resto: match[3].trim(),
  };
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

// =====================================================
// EXTRAER CELDAS DE UNA FILA
// =====================================================

function extractRowCells(row: HTMLElement): string[] {
  const cells = row.querySelectorAll('td');

  return cells.map((cell) => {
    const paragraphs = cell
      .querySelectorAll('p')
      .map((p) => normalizeSpaces(p.text))
      .filter(Boolean);

    if (paragraphs.length > 0) {
      return normalizeSpaces(paragraphs.join(' '));
    }

    return normalizeSpaces(cell.text);
  });
}

// =====================================================
// PROCESO PRINCIPAL
// =====================================================

async function processCalendario(): Promise<void> {
  try {
    console.log('🚀 Iniciando procesamiento del Calendario Escolar 2026...');
    console.log(`📄 Archivo fuente: ${SOURCE_FILE}`);

    if (!fs.existsSync(SOURCE_FILE)) {
      throw new Error(`❌ No existe el archivo:\n${SOURCE_FILE}`);
    }

    fs.mkdirSync(OUTPUT_DIRECTORY, { recursive: true });

    console.log('📖 Convirtiendo DOCX a HTML con mammoth...');

    const result = await mammoth.convertToHtml({ path: SOURCE_FILE });

    if (result.messages.length > 0) {
      console.log('ℹ️ Mammoth generó mensajes durante la conversión:');

      for (const message of result.messages) {
        console.log(`   - ${message.message}`);
      }
    }

    const root = parse(result.value);

    const nodes = root.childNodes.filter(
      (node): node is HTMLElement => node.nodeType === 1
    );

    console.log(`✅ Nodos de nivel superior encontrados: ${nodes.length}`);

    // -----------------------------------------------------
    // Estado del recorrido
    // -----------------------------------------------------

    type Phase =
      | 'front-matter'
      | 'articles'
      | 'anexo1'
      | 'skip-anexo2'
      | 'anexo3-prose'
      | 'anexo3-table'
      | 'anexo4-table'
      | 'anexo5-glossary'
      | 'done';

    let phase: Phase = 'front-matter';

    const chunks: OutputChunk[] = [];

    // Artículos 1-4
    let articleBuffer: { number: number; text: string } | null = null;

    // Tópicos de prosa (Anexo I y Anexo III)
    let topicBuffer: TopicDraft | null = null;

    // Tabla de actividades Nivel Superior (Anexo III)
    const anexo3Activities: ActivityEntry[] = [];
    let anexo3CurrentMonth: string | null = null;

    // Tabla de efemérides (Anexo IV), agrupadas por mes
    const efemeridesByMonth = new Map<string, string[]>();
    let lastEfemerideMonth: string | null = null;

    // Glosario (Anexo V)
    let glosarioIndex = 0;

    // -----------------------------------------------------
    // Helpers de flush
    // -----------------------------------------------------

    function flushArticle(): void {
      if (!articleBuffer) return;

      chunks.push({
        id: `calendario-4706-art-${articleBuffer.number}`,
        sourceId: SOURCE_ID,
        document: DOCUMENT_NAME,
        resolution: RESOLUTION,
        jurisdiction: JURISDICTION,
        chapter: null,
        section: null,
        article: articleBuffer.number,
        inciso: null,
        chunkIndex: 1,
        kind: 'article',
        text: normalizeSpaces(articleBuffer.text),
        type: 'normativa',
      });

      articleBuffer = null;
    }

    function flushTopic(): void {
      if (!topicBuffer) return;

      const fullText = normalizeSpaces(topicBuffer.paragraphs.join(' '));

      if (!fullText) {
        topicBuffer = null;
        return;
      }

      const slug = slugify(topicBuffer.section);
      const prefix = chapterSlug(topicBuffer.chapter);

      if (fullText.length <= MAX_TOPIC_LENGTH) {
        chunks.push({
          id: `calendario-4706-${prefix}-${slug}-01`,
          sourceId: SOURCE_ID,
          document: DOCUMENT_NAME,
          resolution: RESOLUTION,
          jurisdiction: JURISDICTION,
          chapter: topicBuffer.chapter,
          section: topicBuffer.section,
          article: null,
          inciso: null,
          chunkIndex: 1,
          kind: 'section-intro',
          text: fullText,
          type: 'normativa',
        });

        topicBuffer = null;
        return;
      }

      // Tópico largo: lo partimos en varios chunks por oraciones/frases,
      // igual de espíritu que splitArticleIntoChunks() en processRam.ts.
      const sentences = fullText.split(/(?<=[.:;])\s+/);

      let buffer: string[] = [];
      let index = 1;

      const pushBuffer = () => {
        const text = normalizeSpaces(buffer.join(' '));
        if (!text) return;

        chunks.push({
          id: `calendario-4706-${prefix}-${slug}-${String(index).padStart(2, '0')}`,
          sourceId: SOURCE_ID,
          document: DOCUMENT_NAME,
          resolution: RESOLUTION,
          jurisdiction: JURISDICTION,
          chapter: topicBuffer!.chapter,
          section: topicBuffer!.section,
          article: null,
          inciso: null,
          chunkIndex: index,
          kind: 'section-intro',
          text,
          type: 'normativa',
        });

        index++;
        buffer = [];
      };

      for (const sentence of sentences) {
        const currentLength = buffer.join(' ').length;

        if (
          currentLength + sentence.length > MAX_TOPIC_LENGTH &&
          buffer.length > 0
        ) {
          pushBuffer();
        }

        buffer.push(sentence);
      }

      pushBuffer();

      topicBuffer = null;
    }

    function startTopic(chapter: string | null, section: string): void {
      flushTopic();
      topicBuffer = { chapter, section: normalizeSpaces(section), paragraphs: [] };
    }

    function appendToTopic(text: string): void {
      const clean = normalizeSpaces(text);
      if (clean && topicBuffer) {
        topicBuffer.paragraphs.push(clean);
      }
    }

    function flushAnexo3Activities(): void {
      const perMonth = new Map<string, number>();

      for (const entry of anexo3Activities) {
        const monthKey = entry.month ?? 'sin-mes';
        const seq = (perMonth.get(monthKey) ?? 0) + 1;
        perMonth.set(monthKey, seq);

        const nivelText = entry.nivel ? ` Nivel/Dependencia: ${entry.nivel}.` : '';

        const text = normalizeSpaces(
          `Fecha: ${entry.fecha}. Actividad: ${entry.actividad}.${nivelText}`
        );

        chunks.push({
          id: `calendario-4706-anexo3-actividad-${slugify(monthKey)}-${String(
            seq
          ).padStart(2, '0')}`,
          sourceId: SOURCE_ID,
          document: DOCUMENT_NAME,
          resolution: RESOLUTION,
          jurisdiction: JURISDICTION,
          chapter: 'Anexo III - Nivel Superior',
          section: entry.month ? capitalize(entry.month) : 'Sin mes',
          article: null,
          inciso: null,
          chunkIndex: seq,
          kind: 'article',
          text,
          type: 'normativa',
        });
      }
    }

    function flushEfemerides(): void {
      for (const [month, lines] of efemeridesByMonth.entries()) {
        const text = normalizeSpaces(
          `Efemérides y conmemoraciones de ${month}: ` + lines.join(' | ')
        );

        chunks.push({
          id: `calendario-4706-anexo4-efemerides-${slugify(month)}`,
          sourceId: SOURCE_ID,
          document: DOCUMENT_NAME,
          resolution: RESOLUTION,
          jurisdiction: JURISDICTION,
          chapter: 'Anexo IV - Efemérides',
          section: capitalize(month),
          article: null,
          inciso: null,
          chunkIndex: 1,
          kind: 'article',
          text,
          type: 'normativa',
        });
      }
    }

    // -----------------------------------------------------
    // Procesar filas de tabla (sirve para Anexo III y IV)
    // -----------------------------------------------------

    function processTable(table: HTMLElement, columns: 2 | 3): void {
      const rows = table.querySelectorAll('tr');

      for (const row of rows) {
        const cells = extractRowCells(row);

        // Fila de encabezado repetido ("Fecha" / "FECHA")
        if (cells[0] && cells[0].toLowerCase().startsWith('fecha')) {
          continue;
        }

        // Fila de un solo valor: puede ser encabezado de mes (Anexo III),
        // el inicio de una nueva efeméride en una sola celda (Anexo IV),
        // o texto envuelto que continúa la fila anterior.
        if (cells.length === 1) {
          if (columns === 3) {
            const asMonth = isMonthHeaderText(cells[0]);

            if (asMonth) {
              anexo3CurrentMonth = asMonth;
              continue;
            }

            // Continuación: se pega al final del último registro.
            if (anexo3Activities.length > 0) {
              const last = anexo3Activities[anexo3Activities.length - 1];
              last.actividad = normalizeSpaces(`${last.actividad} ${cells[0]}`);
            }

            continue;
          }

          // columns === 2 (Anexo IV, formato de una sola celda)
          const parsed = parseSingleCellEfemeride(cells[0]);

          if (parsed) {
            if (!efemeridesByMonth.has(parsed.month)) {
              efemeridesByMonth.set(parsed.month, []);
            }

            efemeridesByMonth
              .get(parsed.month)!
              .push(normalizeSpaces(`${parsed.fecha} ${parsed.resto}`));

            lastEfemerideMonth = parsed.month;
            continue;
          }

          // Continuación de texto envuelto: se pega a la última
          // efeméride agregada, sea cual sea su mes.
          if (lastEfemerideMonth) {
            const list = efemeridesByMonth.get(lastEfemerideMonth);
            if (list && list.length > 0) {
              list[list.length - 1] = normalizeSpaces(
                `${list[list.length - 1]} ${cells[0]}`
              );
            }
          }

          continue;
        }

        if (columns === 3 && cells.length >= 3) {
          anexo3Activities.push({
            month: anexo3CurrentMonth,
            fecha: cells[0],
            actividad: cells[1],
            nivel: cells[2] || null,
          });
        } else if (columns === 2 && cells.length >= 2) {
          const month = findMonthInText(cells[0]) ?? lastEfemerideMonth ?? 'sin-mes';
          const line = `${cells[0]} ${cells[1]}`;

          if (!efemeridesByMonth.has(month)) {
            efemeridesByMonth.set(month, []);
          }

          efemeridesByMonth.get(month)!.push(normalizeSpaces(line));
          lastEfemerideMonth = month;
        }
      }
    }

    // -----------------------------------------------------
    // Recorrido principal
    // -----------------------------------------------------

    for (const node of nodes) {
      const tag = node.tagName;
      const text = node.text;

      // ---------------------------------------------------
      // FRONT MATTER (portada, autoridades)
      // ---------------------------------------------------

      if (phase === 'front-matter') {
        if (tag === 'H1' && /RESUELVE/i.test(text)) {
          phase = 'articles';
        }
        continue;
      }

      // ---------------------------------------------------
      // ARTÍCULOS 1-4
      // ---------------------------------------------------

      if (phase === 'articles') {
        const match = text.match(/^ART[ÍI]CULO\s+(\d+)/i);

        if (match) {
          flushArticle();
          articleBuffer = { number: Number(match[1]), text };
          continue;
        }

        if (tag === 'H2' && /^ANEXO I\b/i.test(text)) {
          flushArticle();
          phase = 'anexo1';
          continue;
        }

        continue;
      }

      // ---------------------------------------------------
      // ANEXO I - DISPOSICIONES GENERALES
      // ---------------------------------------------------

      if (phase === 'anexo1') {
        if (tag === 'H2' && /^ANEXO II\b/i.test(text)) {
          flushTopic();
          phase = 'skip-anexo2';
          continue;
        }

        if (tag === 'H2') {
          startTopic('Anexo I - Disposiciones Generales', text);
          continue;
        }

        if (tag === 'H3') {
          appendToTopic(text);
          continue;
        }

        if (tag === 'P' || tag === 'OL' || tag === 'UL') {
          if (tag === 'OL' || tag === 'UL') {
            const items = node.querySelectorAll('li').map((li) => li.text);
            for (const item of items) appendToTopic(item);
          } else {
            appendToTopic(text);
          }
          continue;
        }

        continue;
      }

      // ---------------------------------------------------
      // ANEXO II (fuera de alcance)
      // ---------------------------------------------------

      if (phase === 'skip-anexo2') {
        if (tag === 'H2' && /^ANEXO III\b/i.test(text)) {
          phase = 'anexo3-prose';
          continue;
        }
        continue;
      }

      // ---------------------------------------------------
      // ANEXO III - NIVEL SUPERIOR (prosa)
      // ---------------------------------------------------

      if (phase === 'anexo3-prose') {
        if (tag === 'H3' && /^Distribuci[óo]n de las Actividades/i.test(text)) {
          flushTopic();
          phase = 'anexo3-table';
          continue;
        }

        if (tag === 'H3') {
          startTopic('Anexo III - Nivel Superior', text);
          continue;
        }

        if (tag === 'P' || tag === 'OL' || tag === 'UL') {
          if (tag === 'OL' || tag === 'UL') {
            const items = node.querySelectorAll('li').map((li) => li.text);
            for (const item of items) appendToTopic(item);
          } else {
            appendToTopic(text);
          }
          continue;
        }

        continue;
      }

      // ---------------------------------------------------
      // ANEXO III - TABLA DE ACTIVIDADES (Nivel Superior)
      // ---------------------------------------------------

      if (phase === 'anexo3-table') {
        if (tag === 'TABLE') {
          processTable(node, 3);
          continue;
        }

        if (tag === 'H2' && /^ANEXO IV\b/i.test(text)) {
          flushAnexo3Activities();
          phase = 'anexo4-table';
          continue;
        }

        continue;
      }

      // ---------------------------------------------------
      // ANEXO IV - EFEMÉRIDES
      // ---------------------------------------------------

      if (phase === 'anexo4-table') {
        if (tag === 'TABLE') {
          processTable(node, 2);
          continue;
        }

        if (tag === 'H2' && /^ANEXO V\b/i.test(text)) {
          flushEfemerides();
          phase = 'anexo5-glossary';
          continue;
        }

        continue;
      }

      // ---------------------------------------------------
      // ANEXO V - GLOSARIO DE SIGLAS
      // ---------------------------------------------------

      if (phase === 'anexo5-glossary') {
        if (tag === 'P' && normalizeSpaces(text)) {
          glosarioIndex++;

          chunks.push({
            id: `calendario-4706-anexo5-glosario-${String(glosarioIndex).padStart(
              2,
              '0'
            )}`,
            sourceId: SOURCE_ID,
            document: DOCUMENT_NAME,
            resolution: RESOLUTION,
            jurisdiction: JURISDICTION,
            chapter: 'Anexo V - Glosario de Siglas',
            section: 'Glosario de Siglas',
            article: null,
            inciso: null,
            chunkIndex: glosarioIndex,
            kind: 'article',
            text: normalizeSpaces(text),
            type: 'normativa',
          });
        }

        continue;
      }
    }

    // Por si el documento terminase en medio de un tópico/artículo.
    flushArticle();
    flushTopic();

    // -------------------------------------------------
    // Validaciones
    // -------------------------------------------------

    console.log('\n🔎 Validando resultado...');

    if (chunks.length === 0) {
      throw new Error('❌ No se generó ningún chunk. Revisar el parser.');
    }

    const byChapter = new Map<string, number>();
    for (const chunk of chunks) {
      const key = chunk.chapter ?? 'Artículos (sin anexo)';
      byChapter.set(key, (byChapter.get(key) ?? 0) + 1);
    }

    for (const [chapter, count] of byChapter.entries()) {
      console.log(`   📦 ${chapter}: ${count} chunk(s)`);
    }

    const lengths = chunks.map((c) => c.text.length);
    const shortChunks = chunks.filter((c) => c.text.length < 40);

    if (shortChunks.length > 0) {
      console.warn(
        `⚠️ ${shortChunks.length} chunk(s) con menos de 40 caracteres (revisar):`
      );
      for (const c of shortChunks.slice(0, 10)) {
        console.warn(`   - ${c.id}: "${c.text}"`);
      }
    }

    console.log(`\n📊 Total de chunks: ${chunks.length}`);
    console.log(`📏 Más corto: ${Math.min(...lengths)} caracteres`);
    console.log(`📏 Más largo: ${Math.max(...lengths)} caracteres`);
    console.log(
      `📏 Promedio: ${Math.round(
        lengths.reduce((a, b) => a + b, 0) / lengths.length
      )} caracteres`
    );

    // -------------------------------------------------
    // Guardar archivo
    // -------------------------------------------------

    const output = {
      metadata: {
        sourceId: SOURCE_ID,
        document: DOCUMENT_NAME,
        resolution: RESOLUTION,
        jurisdiction: JURISDICTION,
        generatedAt: new Date().toISOString(),
        scope:
          'Artículos 1-4, Anexo I (Disposiciones Generales), Anexo III (Nivel Superior) y su cronograma, Anexo IV (Efemérides, agrupadas por mes) y Anexo V (Glosario). No incluye Anexo II (Inicial/Primario/Secundario/C.E.F.).',
        totalChunks: chunks.length,
        chunksByChapter: Object.fromEntries(byChapter),
      },
      chunks,
    };

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf-8');

    console.log('\n🎉 Calendario Escolar 2026 procesado correctamente.');
    console.log(`📦 Archivo generado:\n${OUTPUT_FILE}`);
  } catch (error: unknown) {
    console.error('\n🔥 Error procesando el Calendario Escolar:');

    if (error instanceof Error) {
      console.error(error.message);
      console.error(error.stack);
    } else {
      console.error(error);
    }

    process.exitCode = 1;
  }
}

processCalendario();
