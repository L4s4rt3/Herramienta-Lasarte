-- Migration: Sistema RAG para Vadim (chatbot inteligente)
-- Fecha: 2026-05-29

-- Extensión para embeddings vectoriales
CREATE EXTENSION IF NOT EXISTS vector;

-- Tabla para almacenar embeddings del código fuente
CREATE TABLE IF NOT EXISTS code_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_path TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding VECTOR(1536) NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla para almacenar conversaciones del chatbot
CREATE TABLE IF NOT EXISTS chat_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  embedding VECTOR(1536),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla para conocimiento aprendido (feedback, correcciones, etc.)
CREATE TABLE IF NOT EXISTS chat_knowledge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  embedding VECTOR(1536),
  feedback_score INTEGER CHECK (feedback_score >= 1 AND feedback_score <= 5),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para búsqueda vectorial
CREATE INDEX IF NOT EXISTS idx_code_embeddings_embedding ON code_embeddings 
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_chat_conversations_embedding ON chat_conversations 
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_chat_knowledge_embedding ON chat_knowledge 
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Índices para filtros comunes
CREATE INDEX IF NOT EXISTS idx_code_embeddings_file_path ON code_embeddings(file_path);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_user_id ON chat_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_created_at ON chat_conversations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_knowledge_user_id ON chat_knowledge(user_id);

-- Función para buscar código similar
CREATE OR REPLACE FUNCTION search_code(
  query_embedding VECTOR(1536),
  match_threshold FLOAT DEFAULT 0.5,
  match_count INTEGER DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  file_path TEXT,
  content TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ce.id,
    ce.file_path,
    ce.content,
    1 - (ce.embedding <=> query_embedding) AS similarity
  FROM code_embeddings ce
  WHERE 1 - (ce.embedding <=> query_embedding) > match_threshold
  ORDER BY ce.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Función para buscar conversaciones similares
CREATE OR REPLACE FUNCTION search_conversations(
  query_embedding VECTOR(1536),
  user_uuid UUID,
  match_threshold FLOAT DEFAULT 0.7,
  match_count INTEGER DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  role TEXT,
  content TEXT,
  similarity FLOAT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    cc.id,
    cc.role,
    cc.content,
    1 - (cc.embedding <=> query_embedding) AS similarity,
    cc.created_at
  FROM chat_conversations cc
  WHERE cc.user_id = user_uuid
    AND 1 - (cc.embedding <=> query_embedding) > match_threshold
  ORDER BY cc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Función para buscar conocimiento aprendido
CREATE OR REPLACE FUNCTION search_knowledge(
  query_embedding VECTOR(1536),
  match_threshold FLOAT DEFAULT 0.7,
  match_count INTEGER DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  question TEXT,
  answer TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ck.id,
    ck.question,
    ck.answer,
    1 - (ck.embedding <=> query_embedding) AS similarity
  FROM chat_knowledge ck
  WHERE 1 - (ck.embedding <=> query_embedding) > match_threshold
  ORDER BY ck.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Políticas RLS (Row Level Security)
ALTER TABLE code_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_knowledge ENABLE ROW LEVEL SECURITY;

-- code_embeddings: todos los usuarios autenticados pueden leer
CREATE POLICY "code_embeddings_select" ON code_embeddings
  FOR SELECT TO authenticated
  USING (true);

-- chat_conversations: usuarios solo ven sus propias conversaciones
CREATE POLICY "chat_conversations_select" ON chat_conversations
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "chat_conversations_insert" ON chat_conversations
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "chat_conversations_delete" ON chat_conversations
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- chat_knowledge: todos pueden leer, solo propietarios pueden insertar/actualizar
CREATE POLICY "chat_knowledge_select" ON chat_knowledge
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "chat_knowledge_insert" ON chat_knowledge
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "chat_knowledge_update" ON chat_knowledge
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

-- Trigger para actualizar updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_code_embeddings_updated_at
  BEFORE UPDATE ON code_embeddings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
