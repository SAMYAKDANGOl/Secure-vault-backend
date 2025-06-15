const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

async function applyMigration() {
  console.log('Applying migration...');
  
  try {
    // Add encryption columns to files table
    const { error: alterError } = await supabase
      .rpc('exec_sql', {
        sql: `
          ALTER TABLE files
          ADD COLUMN IF NOT EXISTS encryption_metadata JSONB,
          ADD COLUMN IF NOT EXISTS encryption_key TEXT,
          ADD COLUMN IF NOT EXISTS file_hash TEXT;
        `
      });

    if (alterError) {
      throw alterError;
    }

    // Create index on file_hash
    const { error: indexError } = await supabase
      .rpc('exec_sql', {
        sql: `
          CREATE INDEX IF NOT EXISTS idx_files_file_hash ON files(file_hash);
        `
      });

    if (indexError) {
      throw indexError;
    }

    // Add comments
    const { error: commentError } = await supabase.rpc('exec_sql', {
      sql: `
        COMMENT ON COLUMN files.encryption_metadata IS 'JSON object containing encryption metadata (algorithm, iv, salt, etc.)';
        COMMENT ON COLUMN files.encryption_key IS 'Encryption key used for file encryption (encrypted)';
        COMMENT ON COLUMN files.file_hash IS 'SHA-256 hash of the original file for integrity verification';
      `
    });

    if (commentError) {
      throw commentError;
    }

    // Create get_table_columns function
    const { error: functionError } = await supabase.rpc('exec_sql', {
      sql: `
        CREATE OR REPLACE FUNCTION get_table_columns(table_name text)
        RETURNS TABLE (
            column_name text,
            data_type text,
            is_nullable boolean
        ) LANGUAGE plpgsql SECURITY DEFINER AS $$
        BEGIN
            RETURN QUERY
            SELECT 
                c.column_name::text,
                c.data_type::text,
                (c.is_nullable = 'YES')::boolean
            FROM information_schema.columns c
            WHERE c.table_schema = 'public'
            AND c.table_name = table_name;
        END;
        $$;
      `
    });

    if (functionError) {
      throw functionError;
    }

    console.log('Migration applied successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

applyMigration(); 