const crypto = require("crypto")
const fs = require("fs").promises

class FileValidator {
  constructor() {
    this.allowedMimeTypes = [
      // Images
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "image/svg+xml",
      // Documents
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      // Text
      "text/plain",
      "text/csv",
      "text/html",
      "text/css",
      "text/javascript",
      // Archives
      "application/zip",
      "application/x-rar-compressed",
      "application/x-7z-compressed",
      // Audio
      "audio/mpeg",
      "audio/wav",
      "audio/ogg",
      "audio/mp4",
      // Video
      "video/mp4",
      "video/mpeg",
      "video/quicktime",
      "video/x-msvideo",
    ]

    this.maxFileSize = 100 * 1024 * 1024 // 100MB
  }

  validateFile(file) {
    // Check file size
    if (file.size > this.maxFileSize) {
      return {
        valid: false,
        error: `File size exceeds maximum limit of ${this.maxFileSize / (1024 * 1024)}MB`,
      }
    }

    // Check MIME type
    if (!this.allowedMimeTypes.includes(file.mimetype)) {
      return {
        valid: false,
        error: `File type ${file.mimetype} is not allowed`,
      }
    }

    // Check for suspicious file extensions
    const suspiciousExtensions = [".exe", ".bat", ".cmd", ".scr", ".pif", ".com"]
    const fileExtension = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf("."))

    if (suspiciousExtensions.includes(fileExtension)) {
      return {
        valid: false,
        error: `File extension ${fileExtension} is not allowed for security reasons`,
      }
    }

    return { valid: true }
  }

  async calculateHash(filePath) {
    try {
      const fileBuffer = await fs.readFile(filePath)
      return crypto.createHash("sha256").update(fileBuffer).digest("hex")
    } catch (error) {
      console.error("Hash calculation error:", error)
      throw error
    }
  }

  async verifyFileIntegrity(filePath, expectedHash) {
    try {
      const actualHash = await this.calculateHash(filePath)
      return actualHash === expectedHash
    } catch (error) {
      console.error("File integrity verification error:", error)
      return false
    }
  }

  scanForMalware(filePath) {
    // Placeholder for malware scanning
    // In production, integrate with services like VirusTotal, ClamAV, etc.
    return new Promise((resolve) => {
      // Simulate scan
      setTimeout(() => {
        resolve({ clean: true, threats: [] })
      }, 100)
    })
  }

  async performSecurityScan(filePath) {
    try {
      // Calculate file hash
      const hash = await this.calculateHash(filePath)

      // Perform malware scan
      const scanResult = await this.scanForMalware(filePath)

      return {
        hash,
        malwareScan: scanResult,
        timestamp: new Date().toISOString(),
      }
    } catch (error) {
      console.error("Security scan error:", error)
      throw error
    }
  }
}

module.exports = new FileValidator()
