-- Add MFA-related columns to user_profiles table
ALTER TABLE user_profiles 
ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS mfa_secret TEXT,
ADD COLUMN IF NOT EXISTS mfa_backup_codes TEXT[], -- Array of backup codes
ADD COLUMN IF NOT EXISTS mfa_enabled_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS mfa_disabled_at TIMESTAMP WITH TIME ZONE;

-- Add index for MFA status queries
CREATE INDEX IF NOT EXISTS idx_user_profiles_mfa_enabled ON user_profiles(mfa_enabled);

-- Add comment to document the MFA columns
COMMENT ON COLUMN user_profiles.mfa_enabled IS 'Whether two-factor authentication is enabled for this user';
COMMENT ON COLUMN user_profiles.mfa_secret IS 'TOTP secret key for authenticator apps (encrypted)';
COMMENT ON COLUMN user_profiles.mfa_backup_codes IS 'Array of backup codes for account recovery';
COMMENT ON COLUMN user_profiles.mfa_enabled_at IS 'Timestamp when MFA was enabled';
COMMENT ON COLUMN user_profiles.mfa_disabled_at IS 'Timestamp when MFA was disabled'; 