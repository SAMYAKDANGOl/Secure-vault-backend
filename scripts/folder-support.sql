-- Add folder support to the files table
-- This script adds folder functionality to the existing files table

-- Add folder-related columns to the files table
ALTER TABLE files 
ADD COLUMN IF NOT EXISTS is_folder BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS parent_folder_id UUID REFERENCES files(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS folder_path TEXT,
ADD COLUMN IF NOT EXISTS folder_depth INTEGER DEFAULT 0;

-- Add indexes for folder operations
CREATE INDEX IF NOT EXISTS idx_files_is_folder ON files(is_folder);
CREATE INDEX IF NOT EXISTS idx_files_parent_folder_id ON files(parent_folder_id);
CREATE INDEX IF NOT EXISTS idx_files_folder_path ON files(folder_path);
CREATE INDEX IF NOT EXISTS idx_files_folder_depth ON files(folder_depth);

-- Create a composite index for efficient folder queries
CREATE INDEX IF NOT EXISTS idx_files_user_folder ON files(user_id, is_folder, parent_folder_id);

-- Add comments to document the new columns
COMMENT ON COLUMN files.is_folder IS 'Indicates if this record represents a folder (true) or file (false)';
COMMENT ON COLUMN files.parent_folder_id IS 'Reference to parent folder. NULL for root level items';
COMMENT ON COLUMN files.folder_path IS 'Full path of the folder (e.g., /Documents/Work/Projects)';
COMMENT ON COLUMN files.folder_depth IS 'Depth level in the folder hierarchy (0 for root, 1 for first level, etc.)';

-- Update existing files to have proper folder structure
-- Set all existing files to root level (no parent folder)
UPDATE files 
SET 
    is_folder = FALSE,
    parent_folder_id = NULL,
    folder_path = '/',
    folder_depth = 0
WHERE is_folder IS NULL;

-- Create a function to update folder paths when parent folders change
CREATE OR REPLACE FUNCTION update_folder_path()
RETURNS TRIGGER AS $$
BEGIN
    -- If this is a folder and has a parent, update the path
    IF NEW.is_folder = TRUE AND NEW.parent_folder_id IS NOT NULL THEN
        -- Get parent folder path
        SELECT folder_path INTO NEW.folder_path
        FROM files 
        WHERE id = NEW.parent_folder_id;
        
        -- Append current folder name to parent path
        NEW.folder_path = NEW.folder_path || '/' || NEW.original_name;
        NEW.folder_depth = array_length(string_to_array(NEW.folder_path, '/'), 1) - 1;
    ELSEIF NEW.is_folder = TRUE AND NEW.parent_folder_id IS NULL THEN
        -- Root level folder
        NEW.folder_path = '/' || NEW.original_name;
        NEW.folder_depth = 0;
    ELSEIF NEW.is_folder = FALSE THEN
        -- File: use parent folder path or root
        IF NEW.parent_folder_id IS NOT NULL THEN
            SELECT folder_path INTO NEW.folder_path
            FROM files 
            WHERE id = NEW.parent_folder_id;
        ELSE
            NEW.folder_path = '/';
        END IF;
        NEW.folder_depth = array_length(string_to_array(NEW.folder_path, '/'), 1) - 1;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update folder paths
DROP TRIGGER IF EXISTS trigger_update_folder_path ON files;
CREATE TRIGGER trigger_update_folder_path
    BEFORE INSERT OR UPDATE ON files
    FOR EACH ROW
    EXECUTE FUNCTION update_folder_path();

-- Create a function to recursively update child folder paths when a parent folder is moved
CREATE OR REPLACE FUNCTION update_child_folder_paths()
RETURNS TRIGGER AS $$
BEGIN
    -- If this is a folder and its path changed, update all children
    IF NEW.is_folder = TRUE AND (OLD.folder_path IS DISTINCT FROM NEW.folder_path) THEN
        UPDATE files 
        SET 
            folder_path = NEW.folder_path || substring(folder_path from length(OLD.folder_path) + 1),
            folder_depth = array_length(string_to_array(NEW.folder_path || substring(folder_path from length(OLD.folder_path) + 1), '/'), 1) - 1
        WHERE folder_path LIKE OLD.folder_path || '/%';
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to update child folder paths
DROP TRIGGER IF EXISTS trigger_update_child_folder_paths ON files;
CREATE TRIGGER trigger_update_child_folder_paths
    AFTER UPDATE ON files
    FOR EACH ROW
    EXECUTE FUNCTION update_child_folder_paths();

-- Create a function to get folder tree structure
CREATE OR REPLACE FUNCTION get_folder_tree(user_uuid UUID, parent_folder_uuid UUID DEFAULT NULL)
RETURNS TABLE (
    id UUID,
    name TEXT,
    is_folder BOOLEAN,
    parent_folder_id UUID,
    folder_path TEXT,
    folder_depth INTEGER,
    size BIGINT,
    mime_type TEXT,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        f.id,
        f.original_name as name,
        f.is_folder,
        f.parent_folder_id,
        f.folder_path,
        f.folder_depth,
        f.size,
        f.mime_type,
        f.created_at,
        f.updated_at
    FROM files f
    WHERE f.user_id = user_uuid 
        AND f.deleted = FALSE
        AND f.parent_folder_id IS NOT DISTINCT FROM parent_folder_uuid
    ORDER BY f.is_folder DESC, f.original_name ASC;
END;
$$ LANGUAGE plpgsql;

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION get_folder_tree(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION update_folder_path() TO authenticated;
GRANT EXECUTE ON FUNCTION update_child_folder_paths() TO authenticated; 