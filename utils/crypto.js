const crypto = require("crypto")
const fs = require("fs").promises

const ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 16
const TAG_LENGTH = 16
const KEY_LENGTH = 32
const SALT_LENGTH = 64
const ITERATIONS = 100000

/**
 * Encrypt a file buffer with AES-256-GCM
 * @param {Buffer} fileBuffer - The file data to encrypt
 * @param {string} password - User password for key derivation
 * @param {Buffer} salt - Random salt for key derivation
 * @returns {Object} - Encrypted data with metadata
 */
async function encryptFileBuffer(fileBuffer, password, salt = null) {
  try {
    // Generate salt if not provided
    const fileSalt = salt || crypto.randomBytes(SALT_LENGTH)
    
    // Derive encryption key from password and salt
    const key = crypto.pbkdf2Sync(password, fileSalt, ITERATIONS, KEY_LENGTH, 'sha512')
    
    // Generate random IV
    const iv = crypto.randomBytes(IV_LENGTH)
    
    // Create cipher using createCipheriv (newer API)
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
    cipher.setAAD(Buffer.from("secure-vault-file"))
    
    // Encrypt the file
    let encrypted = cipher.update(fileBuffer)
    encrypted = Buffer.concat([encrypted, cipher.final()])
    
    // Get authentication tag
    const tag = cipher.getAuthTag()
    
    // Combine all components: salt + iv + tag + encrypted data
    const result = Buffer.concat([fileSalt, iv, tag, encrypted])
    
    return {
      encryptedData: result,
      salt: fileSalt.toString('hex'),
      iv: iv.toString('hex'),
      tag: tag.toString('hex')
    }
  } catch (error) {
    console.error("Encryption error:", error)
    throw new Error(`Encryption failed: ${error.message}`)
  }
}

/**
 * Decrypt a file buffer with AES-256-GCM
 * @param {Buffer} encryptedBuffer - The encrypted file data
 * @param {string} password - User password for key derivation
 * @returns {Buffer} - Decrypted file data
 */
async function decryptFileBuffer(encryptedBuffer, password) {
  try {
    // Extract components from encrypted buffer
    const salt = encryptedBuffer.slice(0, SALT_LENGTH)
    const iv = encryptedBuffer.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH)
    const tag = encryptedBuffer.slice(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH)
    const encrypted = encryptedBuffer.slice(SALT_LENGTH + IV_LENGTH + TAG_LENGTH)
    
    // Derive decryption key from password and salt
    const key = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, 'sha512')
    
    // Create decipher using createDecipheriv (newer API)
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
    decipher.setAAD(Buffer.from("secure-vault-file"))
    decipher.setAuthTag(tag)
    
    // Decrypt the file
    let decrypted = decipher.update(encrypted)
    decrypted = Buffer.concat([decrypted, decipher.final()])
    
    return decrypted
  } catch (error) {
    console.error("Decryption error:", error)
    throw new Error(`Decryption failed: ${error.message}`)
  }
}

/**
 * Encrypt a file from disk
 * @param {string} inputPath - Path to input file
 * @param {string} outputPath - Path to output encrypted file
 * @param {string} password - User password
 * @returns {Object} - Encryption metadata
 */
async function encryptFile(inputPath, outputPath, password) {
  try {
    const fileBuffer = await fs.readFile(inputPath)
    const result = await encryptFileBuffer(fileBuffer, password)
    
    await fs.writeFile(outputPath, result.encryptedData)
    
    return {
      success: true,
      salt: result.salt,
      iv: result.iv,
      tag: result.tag,
      originalSize: fileBuffer.length,
      encryptedSize: result.encryptedData.length
    }
  } catch (error) {
    console.error("File encryption error:", error)
    throw error
  }
}

/**
 * Decrypt a file from disk
 * @param {string} inputPath - Path to encrypted file
 * @param {string} outputPath - Path to decrypted file
 * @param {string} password - User password
 * @returns {Object} - Decryption result
 */
async function decryptFile(inputPath, outputPath, password) {
  try {
    const encryptedBuffer = await fs.readFile(inputPath)
    const decryptedBuffer = await decryptFileBuffer(encryptedBuffer, password)
    
    await fs.writeFile(outputPath, decryptedBuffer)
    
    return {
      success: true,
      originalSize: decryptedBuffer.length,
      encryptedSize: encryptedBuffer.length
    }
  } catch (error) {
    console.error("File decryption error:", error)
    throw error
  }
}

/**
 * Generate a secure random encryption key
 * @returns {Buffer} - 32-byte random key
 */
function generateEncryptionKey() {
  return crypto.randomBytes(KEY_LENGTH)
}

/**
 * Generate a secure random salt
 * @returns {Buffer} - 64-byte random salt
 */
function generateSalt() {
  return crypto.randomBytes(SALT_LENGTH)
}

/**
 * Hash a password for storage
 * @param {string} password - Plain text password
 * @param {Buffer} salt - Random salt
 * @returns {string} - Hashed password
 */
function hashPassword(password, salt = null) {
  const passwordSalt = salt || crypto.randomBytes(SALT_LENGTH)
  const hash = crypto.pbkdf2Sync(password, passwordSalt, ITERATIONS, 64, "sha512")
  return {
    hash: hash.toString('hex'),
    salt: passwordSalt.toString('hex')
  }
}

/**
 * Verify a password against a hash
 * @param {string} password - Plain text password
 * @param {string} hash - Stored hash
 * @param {string} salt - Stored salt
 * @returns {boolean} - True if password matches
 */
function verifyPassword(password, hash, salt) {
  const saltBuffer = Buffer.from(salt, 'hex')
  const testHash = crypto.pbkdf2Sync(password, saltBuffer, ITERATIONS, 64, "sha512")
  return crypto.timingSafeEqual(testHash, Buffer.from(hash, 'hex'))
}

/**
 * Generate a secure file hash
 * @param {Buffer} fileBuffer - File data
 * @returns {string} - SHA-256 hash
 */
function generateFileHash(fileBuffer) {
  return crypto.createHash("sha256").update(fileBuffer).digest("hex")
}

/**
 * Generate a secure random token
 * @param {number} length - Token length in bytes
 * @returns {string} - Random token
 */
function generateSecureToken(length = 32) {
  return crypto.randomBytes(length).toString('hex')
}

module.exports = {
  encryptFileBuffer,
  decryptFileBuffer,
  encryptFile,
  decryptFile,
  generateEncryptionKey,
  generateSalt,
  hashPassword,
  verifyPassword,
  generateFileHash,
  generateSecureToken,
  ALGORITHM,
  IV_LENGTH,
  TAG_LENGTH,
  KEY_LENGTH,
  SALT_LENGTH,
  ITERATIONS
}
