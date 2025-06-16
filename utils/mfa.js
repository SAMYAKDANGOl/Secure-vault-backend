const speakeasy = require('speakeasy')
const QRCode = require('qrcode')

/**
 * Generate a new TOTP secret for a user
 * @param {string} userId - User ID
 * @param {string} userEmail - User email
 * @returns {Object} - Secret and QR code data
 */
function generateMFASecret(userId, userEmail) {
  const secret = speakeasy.generateSecret({
    name: `Secure Vault Pro (${userEmail})`,
    issuer: 'Secure Vault Pro',
    length: 32
  })

  return {
    secret: secret.base32,
    otpauthUrl: secret.otpauth_url,
    qrCode: null // Will be generated separately
  }
}

/**
 * Generate QR code for MFA setup
 * @param {string} otpauthUrl - OTP Auth URL
 * @returns {Promise<string>} - QR code as data URL
 */
async function generateQRCode(otpauthUrl) {
  try {
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl)
    return qrCodeDataUrl
  } catch (error) {
    console.error('QR code generation error:', error)
    throw new Error('Failed to generate QR code')
  }
}

/**
 * Verify TOTP token
 * @param {string} secret - User's TOTP secret
 * @param {string} token - Token from authenticator app
 * @returns {boolean} - True if token is valid
 */
function verifyMFAToken(secret, token) {
  try {
    return speakeasy.totp.verify({
      secret: secret,
      encoding: 'base32',
      token: token,
      window: 2 // Allow 2 time steps (60 seconds) of tolerance
    })
  } catch (error) {
    console.error('MFA verification error:', error)
    return false
  }
}

/**
 * Generate backup codes for account recovery
 * @param {number} count - Number of backup codes to generate
 * @returns {Array<string>} - Array of backup codes
 */
function generateBackupCodes(count = 10) {
  const codes = []
  for (let i = 0; i < count; i++) {
    // Generate 8-character alphanumeric codes
    const code = Math.random().toString(36).substring(2, 10).toUpperCase()
    codes.push(code)
  }
  return codes
}

/**
 * Verify backup code
 * @param {Array<string>} backupCodes - User's backup codes
 * @param {string} code - Code to verify
 * @returns {Object} - Result with success and remaining codes
 */
function verifyBackupCode(backupCodes, code) {
  const normalizedCode = code.toUpperCase().replace(/\s/g, '')
  const index = backupCodes.indexOf(normalizedCode)
  
  if (index !== -1) {
    // Remove used code
    const remainingCodes = backupCodes.filter((_, i) => i !== index)
    return {
      success: true,
      remainingCodes
    }
  }
  
  return {
    success: false,
    remainingCodes: backupCodes
  }
}

/**
 * Check if MFA is required for an action
 * @param {Object} userProfile - User profile with MFA settings
 * @param {string} action - Action being performed
 * @returns {boolean} - True if MFA is required
 */
function isMFARequired(userProfile, action) {
  if (!userProfile || !userProfile.mfa_enabled) {
    return false
  }

  // Define which actions require MFA
  const mfaRequiredActions = [
    'file_upload',
    'file_download',
    'file_delete',
    'file_share',
    'file_encrypt',
    'file_decrypt',
    'settings_change',
    'password_change'
  ]

  return mfaRequiredActions.includes(action)
}

module.exports = {
  generateMFASecret,
  generateQRCode,
  verifyMFAToken,
  generateBackupCodes,
  verifyBackupCode,
  isMFARequired
} 