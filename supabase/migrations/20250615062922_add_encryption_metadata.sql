-- Add encryption metadata columns to files table
ALTER TABLE files
ADD COLUMN IF NOT EXISTS encryption_metadata JSONB,
ADD COLUMN IF NOT EXISTS encryption_key TEXT,
ADD COLUMN IF NOT EXISTS file_hash TEXT;

-- Add index for file_hash for faster integrity checks
CREATE INDEX IF NOT EXISTS idx_files_file_hash ON files(file_hash);

-- Add comment to explain the encryption metadata structure
COMMENT ON COLUMN files.encryption_metadata IS 'JSON object containing encryption metadata (algorithm, iv, salt, etc.)';
COMMENT ON COLUMN files.encryption_key IS 'Encryption key used for file encryption (encrypted)';
COMMENT ON COLUMN files.file_hash IS 'SHA-256 hash of the original file for integrity verification';
