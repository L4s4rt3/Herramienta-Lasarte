/**
 * rag.ts — Sistema RAG (Retrieval Augmented Generation) para Vadim
 * Proporciona búsqueda semántica en código fuente y memoria persistente
 */

import { supabase } from '@/integrations/supabase/client';

export interface CodeChunk {
  id: string;
  file_path: string;
  content: string;
  similarity: number;
}

export interface ConversationChunk {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  similarity: number;
  created_at: string;
}

export interface KnowledgeChunk {
  id: string;
  question: string;
  answer: string;
  similarity: number;
}

/**
 * Genera embeddings vía la Edge Function `embeddings`, que guarda la clave de
 * OpenCode en el servidor. Así la clave nunca viaja al navegador.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const { data, error } = await supabase.functions.invoke('embeddings', {
    body: { text },
  });

  if (error) {
    throw new Error(`Error generando embedding: ${error.message}`);
  }

  const embedding = (data as { embedding?: number[] } | null)?.embedding;
  if (!Array.isArray(embedding)) {
    throw new Error('Error generando embedding: respuesta sin embedding');
  }

  return embedding;
}

/**
 * Busca código similar en la base de datos
 */
export async function searchCode(
  query: string,
  matchThreshold = 0.5,
  matchCount = 10
): Promise<CodeChunk[]> {
  try {
    const embedding = await generateEmbedding(query);

    const { data, error } = await supabase.rpc('search_code', {
      query_embedding: JSON.stringify(embedding),
      match_threshold: matchThreshold,
      match_count: matchCount,
    });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error buscando código:', error);
    return [];
  }
}

/**
 * Busca conversaciones similares del usuario
 */
export async function searchConversations(
  query: string,
  userId: string,
  matchThreshold = 0.7,
  matchCount = 5
): Promise<ConversationChunk[]> {
  try {
    const embedding = await generateEmbedding(query);

    const { data, error } = await supabase.rpc('search_conversations', {
      query_embedding: JSON.stringify(embedding),
      user_uuid: userId,
      match_threshold: matchThreshold,
      match_count: matchCount,
    });

    if (error) throw error;
    return (data || []) as ConversationChunk[];
  } catch (error) {
    console.error('Error buscando conversaciones:', error);
    return [];
  }
}

/**
 * Busca conocimiento aprendido
 */
export async function searchKnowledge(
  query: string,
  matchThreshold = 0.7,
  matchCount = 5
): Promise<KnowledgeChunk[]> {
  try {
    const embedding = await generateEmbedding(query);

    const { data, error } = await supabase.rpc('search_knowledge', {
      query_embedding: JSON.stringify(embedding),
      match_threshold: matchThreshold,
      match_count: matchCount,
    });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error buscando conocimiento:', error);
    return [];
  }
}

/**
 * Guarda una conversación en la base de datos con su embedding
 */
export async function saveConversation(
  userId: string,
  role: 'user' | 'assistant',
  content: string,
  metadata: Record<string, any> = {}
): Promise<void> {
  try {
    const embedding = await generateEmbedding(content);

    const { error } = await supabase.from('chat_conversations').insert({
      user_id: userId,
      role,
      content,
      embedding: JSON.stringify(embedding),
      metadata,
    });

    if (error) throw error;
  } catch (error) {
    console.error('Error guardando conversación:', error);
  }
}

/**
 * Guarda conocimiento aprendido (feedback, correcciones, etc.)
 */
export async function saveKnowledge(
  userId: string,
  question: string,
  answer: string,
  feedbackScore?: number,
  metadata: Record<string, any> = {}
): Promise<void> {
  try {
    const embedding = await generateEmbedding(`${question}\n${answer}`);

    const { error } = await supabase.from('chat_knowledge').insert({
      user_id: userId,
      question,
      answer,
      embedding: JSON.stringify(embedding),
      feedback_score: feedbackScore,
      metadata,
    });

    if (error) throw error;
  } catch (error) {
    console.error('Error guardando conocimiento:', error);
  }
}

/**
 * Obtiene contexto RAG completo para una consulta
 */
export async function getRAGContext(
  query: string,
  userId: string
): Promise<{
  codeContext: CodeChunk[];
  conversationContext: ConversationChunk[];
  knowledgeContext: KnowledgeChunk[];
}> {
  const [codeContext, conversationContext, knowledgeContext] = await Promise.all([
    searchCode(query, 0.5, 8),
    searchConversations(query, userId, 0.7, 3),
    searchKnowledge(query, 0.7, 3),
  ]);

  return {
    codeContext,
    conversationContext,
    knowledgeContext,
  };
}

/**
 * Formatea el contexto RAG para inyectar en el system prompt
 */
export function formatRAGContext(context: {
  codeContext: CodeChunk[];
  conversationContext: ConversationChunk[];
  knowledgeContext: KnowledgeChunk[];
}): string {
  const sections: string[] = [];

  if (context.codeContext.length > 0) {
    const codeSection = context.codeContext
      .map(
        (chunk) =>
          `### ${chunk.file_path} (similitud: ${(chunk.similarity * 100).toFixed(0)}%)\n\`\`\`\n${chunk.content.slice(0, 500)}${chunk.content.length > 500 ? '...' : ''}\n\`\`\``
      )
      .join('\n\n');

    sections.push(`## Código relevante del proyecto\n${codeSection}`);
  }

  if (context.conversationContext.length > 0) {
    const convSection = context.conversationContext
      .map(
        (chunk) =>
          `- ${chunk.role === 'user' ? 'Usuario' : 'Vadim'} (${new Date(chunk.created_at).toLocaleDateString('es-ES')}): ${chunk.content.slice(0, 200)}${chunk.content.length > 200 ? '...' : ''}`
      )
      .join('\n');

    sections.push(`## Conversaciones anteriores relevantes\n${convSection}`);
  }

  if (context.knowledgeContext.length > 0) {
    const knowledgeSection = context.knowledgeContext
      .map(
        (chunk) =>
          `**Pregunta:** ${chunk.question}\n**Respuesta:** ${chunk.answer.slice(0, 300)}${chunk.answer.length > 300 ? '...' : ''}`
      )
      .join('\n\n');

    sections.push(`## Conocimiento aprendido\n${knowledgeSection}`);
  }

  return sections.length > 0
    ? `\n\n${'═'.repeat(50)}\nCONTEXTO RAG (búsqueda semántica):\n${sections.join('\n\n')}`
    : '';
}
