const crypto = require("crypto")
const fs = require("fs").promises

const ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 16
const TAG_LENGTH = 16

async function encryptFile(inputPath, outputPath, key) {
  try {
    const iv = crypto.randomBytes(IV_LENGTH)
    const cipher = crypto.createCipher(ALGORITHM, key)
    cipher.setAAD(Buffer.from("secure-vault-file"))

    const inputData = await fs.readFile(inputPath)

    let encrypted = cipher.update(inputData)
    encrypted = Buffer.concat([encrypted, cipher.final()])

    const tag = cipher.getAuthTag()
    const result = Buffer.concat([iv, tag, encrypted])

    await fs.writeFile(outputPath, result)
    return true
  } catch (error) {
    console.error("Encryption error:", error)
    throw error
  }
}

async function decryptFile(encryptedBuffer, key) {
  try {
    const iv = encryptedBuffer.slice(0, IV_LENGTH)
    const tag = encryptedBuffer.slice(IV_LENGTH, IV_LENGTH + TAG_LENGTH)
    const encrypted = encryptedBuffer.slice(IV_LENGTH + TAG_LENGTH)

    const decipher = crypto.createDecipher(ALGORITHM, key)
    decipher.setAAD(Buffer.from("secure-vault-file"))
    decipher.setAuthTag(tag)

    let decrypted = decipher.update(encrypted)
    decrypted = Buffer.concat([decrypted, decipher.final()])

    return decrypted
  } catch (error) {
    console.error("Decryption error:", error)
    throw error
  }
}

// Encrypt file buffer (for in-memory encryption)
async function encryptFileBuffer(buffer, key) {
  try {
    const iv = crypto.randomBytes(IV_LENGTH)
    const cipher = crypto.createCipher(ALGORITHM, key)
    cipher.setAAD(Buffer.from("secure-vault-file"))

    let encrypted = cipher.update(buffer)
    encrypted = Buffer.concat([encrypted, cipher.final()])

    const tag = cipher.getAuthTag()
    const result = Buffer.concat([iv, tag, encrypted])

    return result
  } catch (error) {
    console.error("Buffer encryption error:", error)
    throw error
  }
}

// Decrypt file buffer (for in-memory decryption)
async function decryptFileBuffer(encryptedBuffer, key) {
  try {
    const iv = encryptedBuffer.slice(0, IV_LENGTH)
    const tag = encryptedBuffer.slice(IV_LENGTH, IV_LENGTH + TAG_LENGTH)
    const encrypted = encryptedBuffer.slice(IV_LENGTH + TAG_LENGTH)

    const decipher = crypto.createDecipher(ALGORITHM, key)
    decipher.setAAD(Buffer.from("secure-vault-file"))
    decipher.setAuthTag(tag)

    let decrypted = decipher.update(encrypted)
    decrypted = Buffer.concat([decrypted, decipher.final()])

    return decrypted
  } catch (error) {
    console.error("Buffer decryption error:", error)
    throw error
  }
}

function generateEncryptionKey() {
  return crypto.randomBytes(32)
}

function hashPassword(password) {
  return crypto.pbkdf2Sync(password, "secure-vault-salt", 100000, 64, "sha512")
}

// Generate file hash for integrity verification
function generateFileHash(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex")
}

// Generate secure token for various purposes
function generateSecureToken(length = 32) {
  return crypto.randomBytes(length)
}

module.exports = {
  encryptFile,
  decryptFile,
  encryptFileBuffer,
  decryptFileBuffer,
  generateEncryptionKey,
  hashPassword,
  generateFileHash,
  generateSecureToken,
}
