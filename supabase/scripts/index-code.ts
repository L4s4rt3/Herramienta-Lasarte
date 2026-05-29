/**
 * index-code.ts — Script para indexar el código fuente del proyecto
 * Genera embeddings de todos los archivos y los almacena en Supabase
 * 
 * Uso: npx tsx supabase/scripts/index-code.ts
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import 'dotenv/config';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OPENCODE_API_KEY = 'sk-bAST0NfOL76AkI6WRLHRlgRLjQZ4QUMI2kerlYtXzsKDwYTJP4uvDwg56JUR8Hxo';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const OPENCODE_API_URL = 'https://opencode.ai/zen/v1';

interface FileInfo {
  path: string;
  content: string;
}

/**
 * Lee recursivamente todos los archivos de un directorio
 */
function readDirectory(dir: string, baseDir: string, extensions: string[]): FileInfo[] {
  const files: FileInfo[] = [];
  const entries = readdirSync(dir);

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      // Ignorar node_modules, dist, .git, etc.
      if (['node_modules', 'dist', '.git', '.vercel', 'coverage'].includes(entry)) {
        continue;
      }
      files.push(...readDirectory(fullPath, baseDir, extensions));
    } else if (stat.isFile()) {
      const ext = entry.split('.').pop() || '';
      if (extensions.includes(ext)) {
        try {
          const content = readFileSync(fullPath, 'utf-8');
          const relativePath = relative(baseDir, fullPath);
          files.push({ path: relativePath, content });
        } catch (error) {
          console.warn(`Error leyendo ${fullPath}:`, error);
        }
      }
    }
  }

  return files;
}

/**
 * Divide un archivo en chunks más pequeños para mejor búsqueda
 */
function chunkFile(file: FileInfo, chunkSize = 1000): FileInfo[] {
  const lines = file.content.split('\n');
  const chunks: FileInfo[] = [];
  
  for (let i = 0; i < lines.length; i += chunkSize) {
    const chunkLines = lines.slice(i, i + chunkSize);
    chunks.push({
      path: file.path,
      content: chunkLines.join('\n'),
    });
  }

  return chunks.length > 0 ? chunks : [file];
}

/**
 * Genera embeddings usando la API de OpenCode
 */
async function generateEmbedding(text: string): Promise<number[]> {
  const response = await fetch(`${OPENCODE_API_URL}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENCODE_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Error generando embedding: ${error}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

/**
 * Indexa todos los archivos del proyecto
 */
async function indexCode() {
  console.log('🚀 Iniciando indexación de código fuente...\n');

  const projectRoot = process.cwd();
  const srcDir = join(projectRoot, 'src');
  const supabaseDir = join(projectRoot, 'supabase');

  console.log('📂 Leyendo archivos de src/...');
  const srcFiles = readDirectory(srcDir, projectRoot, ['ts', 'tsx', 'js', 'jsx']);
  console.log(`   Encontrados ${srcFiles.length} archivos\n`);

  console.log('📂 Leyendo archivos de supabase/...');
  const supabaseFiles = readDirectory(supabaseDir, projectRoot, ['ts', 'sql']);
  console.log(`   Encontrados ${supabaseFiles.length} archivos\n`);

  const allFiles = [...srcFiles, ...supabaseFiles];

  console.log('✂️  Dividiendo archivos en chunks...');
  const chunks = allFiles.flatMap(chunkFile);
  console.log(`   Total: ${chunks.length} chunks\n`);

  console.log('🧠 Generando embeddings y guardando en Supabase...\n');

  let success = 0;
  let errors = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const progress = Math.round(((i + 1) / chunks.length) * 100);
    
    process.stdout.write(`\r   Progreso: ${progress}% (${i + 1}/${chunks.length})`);

    try {
      const embedding = await generateEmbedding(chunk.content);

      const { error } = await supabase.from('code_embeddings').insert({
        file_path: chunk.path,
        content: chunk.content,
        embedding,
        metadata: {
          lines: chunk.content.split('\n').length,
          size: chunk.content.length,
        },
      });

      if (error) {
        console.error(`\n❌ Error guardando ${chunk.path}:`, error.message);
        errors++;
      } else {
        success++;
      }

      // Rate limiting: esperar un poco entre requests
      if (i % 10 === 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (error) {
      console.error(`\n❌ Error procesando ${chunk.path}:`, error);
      errors++;
    }
  }

  console.log('\n\n✅ Indexación completada!');
  console.log(`   ✓ Exitosos: ${success}`);
  console.log(`   ✗ Errores: ${errors}`);
  console.log(`   📊 Total: ${chunks.length} chunks indexados\n`);
}

// Ejecutar
indexCode().catch(error => {
  console.error('Error fatal:', error);
  process.exit(1);
});
