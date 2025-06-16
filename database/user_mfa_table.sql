-- Create user_mfa table
CREATE TABLE IF NOT EXISTS user_mfa (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    secret TEXT NOT NULL,
    is_enabled BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id)
);

-- Create folders table
CREATE TABLE IF NOT EXISTS folders (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    parent_id UUID REFERENCES folders(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster folder queries
CREATE INDEX IF NOT EXISTS folders_user_id_idx ON folders(user_id);
CREATE INDEX IF NOT EXISTS folders_parent_id_idx ON folders(parent_id);

-- Add RLS policies for user_mfa table
ALTER TABLE user_mfa ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own MFA settings"
    ON user_mfa FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own MFA settings"
    ON user_mfa FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own MFA settings"
    ON user_mfa FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Add RLS policies for folders table
ALTER TABLE folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own folders"
    ON folders FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own folders"
    ON folders FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own folders"
    ON folders FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own folders"
    ON folders FOR DELETE
    USING (auth.uid() = user_id); 