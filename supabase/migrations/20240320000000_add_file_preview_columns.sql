-- Add columns for file preview and download tracking
ALTER TABLE files
ADD COLUMN IF NOT EXISTS preview_enabled BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS preview_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_previewed TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS download_enabled BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS preview_token TEXT,
ADD COLUMN IF NOT EXISTS preview_token_expires_at TIMESTAMP WITH TIME ZONE;

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_files_preview_enabled ON files(preview_enabled);
CREATE INDEX IF NOT EXISTS idx_files_download_enabled ON files(download_enabled);
CREATE INDEX IF NOT EXISTS idx_files_preview_token ON files(preview_token);

-- Add comments
COMMENT ON COLUMN files.preview_enabled IS 'Whether file preview is enabled';
COMMENT ON COLUMN files.preview_count IS 'Number of times the file has been previewed';
COMMENT ON COLUMN files.last_previewed IS 'Timestamp of last preview';
COMMENT ON COLUMN files.download_enabled IS 'Whether file download is enabled';
COMMENT ON COLUMN files.preview_token IS 'Temporary token for secure preview access';
COMMENT ON COLUMN files.preview_token_expires_at IS 'Expiration timestamp for preview token'; 