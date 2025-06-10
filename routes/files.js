const express = require("express")
const multer = require("multer")
const path = require("path")
const fs = require("fs").promises
const crypto = require("crypto")

const router = express.Router()

// In-memory storage for uploaded files (in production, use a database)
const uploadedFiles = []

// Test endpoint to verify route is working
router.get("/test", async (req, res) => {
  console.log(`[${req.requestId}] Files test endpoint accessed`)
  res.json({
    message: "Files route is working",
    user: req.user.id,
    timestamp: new Date().toISOString(),
  })
})

// Simplified file validator for debugging
const fileValidator = {
  validateFile: (file) => {
    console.log("Validating file:", file.originalname, file.mimetype, file.size)

    // Check file size (100MB limit)
    if (file.size > 100 * 1024 * 1024) {
      return { valid: false, error: "File too large" }
    }

    return { valid: true }
  },

  calculateHash: async (filePath) => {
    try {
      const fileBuffer = await fs.readFile(filePath)
      return crypto.createHash("sha256").update(fileBuffer).digest("hex")
    } catch (error) {
      console.error("Hash calculation error:", error)
      throw error
    }
  },
}

// Simplified audit logger for debugging
const auditLogger = {
  log: async (entry) => {
    console.log("Audit log:", entry)
    return Promise.resolve()
  },
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, "../uploads")
    console.log("Upload directory:", uploadDir)

    try {
      await fs.mkdir(uploadDir, { recursive: true })
      console.log("Upload directory created/verified")
      cb(null, uploadDir)
    } catch (error) {
      console.error("Failed to create upload directory:", error)
      cb(error)
    }
  },
  filename: (req, file, cb) => {
    const uniqueName = crypto.randomUUID() + path.extname(file.originalname)
    console.log("Generated filename:", uniqueName)
    cb(null, uniqueName)
  },
})

const upload = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB
    files: 10,
  },
  fileFilter: (req, file, cb) => {
    console.log("File filter check:", file.originalname)
    const result = fileValidator.validateFile(file)
    if (result.valid) {
      cb(null, true)
    } else {
      cb(new Error(result.error))
    }
  },
})

// Get all files for user
router.get("/", async (req, res) => {
  try {
    console.log(`[${req.requestId}] Getting files for user:`, req.user.id)

    // Filter files for the current user
    const userFiles = uploadedFiles.filter((file) => file.userId === req.user.id)

    console.log(`[${req.requestId}] Found ${userFiles.length} files for user`)
    console.log(
      `[${req.requestId}] Files:`,
      userFiles.map((f) => ({ id: f.id, name: f.name, size: f.size })),
    )

    await auditLogger.log({
      userId: req.user.id,
      action: "files_list",
      resource: "/files",
      ipAddress: req.clientIP,
      userAgent: req.get("User-Agent"),
      success: true,
      details: { count: userFiles.length },
    })

    res.json({ data: userFiles })
  } catch (error) {
    console.error(`[${req.requestId}] Failed to fetch files:`, error)
    res.status(500).json({ error: "Failed to fetch files" })
  }
})

// Upload file
router.post(
  "/upload",
  (req, res, next) => {
    console.log(`[${req.requestId}] Upload endpoint hit - before multer`)
    next()
  },
  upload.single("file"),
  async (req, res) => {
    console.log(`[${req.requestId}] Upload request received - after multer`)

    try {
      if (!req.file) {
        console.log(`[${req.requestId}] No file in request`)
        return res.status(400).json({ error: "No file uploaded" })
      }

      console.log(`[${req.requestId}] File received:`, {
        originalname: req.file.originalname,
        filename: req.file.filename,
        size: req.file.size,
        mimetype: req.file.mimetype,
        path: req.file.path,
      })

      const userId = req.user.id
      const uploadOptions = JSON.parse(req.body.options || "{}")

      console.log(`[${req.requestId}] Upload options:`, uploadOptions)

      // Validate file integrity
      console.log(`[${req.requestId}] Calculating file hash...`)
      const fileHash = await fileValidator.calculateHash(req.file.path)
      console.log(`[${req.requestId}] File hash:`, fileHash)

      // Create file record
      const fileRecord = {
        id: crypto.randomUUID(),
        userId: userId,
        name: req.file.originalname,
        size: req.file.size,
        type: req.file.mimetype,
        uploadedAt: new Date().toISOString(),
        encrypted: uploadOptions.encryption || false,
        shared: false,
        downloadCount: 0,
        lastAccessed: null,
        filePath: req.file.path,
        filename: req.file.filename,
        hash: fileHash,
        accessControl: uploadOptions.accessControl || {},
      }

      // Store in memory (in production, save to database)
      uploadedFiles.push(fileRecord)

      console.log(`[${req.requestId}] File record created:`, {
        id: fileRecord.id,
        name: fileRecord.name,
        size: fileRecord.size,
        userId: fileRecord.userId,
      })

      await auditLogger.log({
        userId,
        action: "file_upload",
        resource: `/files/${fileRecord.id}`,
        ipAddress: req.clientIP,
        userAgent: req.get("User-Agent"),
        success: true,
        details: {
          filename: req.file.originalname,
          size: req.file.size,
          encrypted: uploadOptions.encryption || false,
        },
      })

      console.log(`[${req.requestId}] Upload successful`)
      console.log(`[${req.requestId}] Total files in system:`, uploadedFiles.length)

      res.json({
        success: true,
        file: {
          id: fileRecord.id,
          name: fileRecord.name,
          size: fileRecord.size,
          type: fileRecord.type,
        },
      })
    } catch (error) {
      console.error(`[${req.requestId}] Upload error:`, error)
      console.error(`[${req.requestId}] Error stack:`, error.stack)

      // Clean up files on error
      if (req.file) {
        try {
          await fs.unlink(req.file.path)
          console.log(`[${req.requestId}] Cleaned up file:`, req.file.path)
        } catch (cleanupError) {
          console.error(`[${req.requestId}] Cleanup error:`, cleanupError)
        }
      }

      res.status(500).json({
        error: "Upload failed: " + error.message,
        requestId: req.requestId,
      })
    }
  },
)

// Download endpoint
router.get("/:id/download", async (req, res) => {
  try {
    console.log(`[${req.requestId}] Download request for file:`, req.params.id)

    // Find the file
    const file = uploadedFiles.find((f) => f.id === req.params.id && f.userId === req.user.id)

    if (!file) {
      console.log(`[${req.requestId}] File not found:`, req.params.id)
      return res.status(404).json({ error: "File not found" })
    }

    console.log(`[${req.requestId}] Found file:`, file.name)

    // Check if file exists on disk
    try {
      await fs.access(file.filePath)
    } catch (error) {
      console.log(`[${req.requestId}] File not found on disk:`, file.filePath)
      return res.status(404).json({ error: "File not found on disk" })
    }

    // Update download count
    file.downloadCount = (file.downloadCount || 0) + 1
    file.lastAccessed = new Date().toISOString()

    // Send file
    res.download(file.filePath, file.name, (err) => {
      if (err) {
        console.error(`[${req.requestId}] Download error:`, err)
      } else {
        console.log(`[${req.requestId}] Download successful:`, file.name)
      }
    })

    await auditLogger.log({
      userId: req.user.id,
      action: "file_download",
      resource: `/files/${req.params.id}`,
      ipAddress: req.clientIP,
      userAgent: req.get("User-Agent"),
      success: true,
      details: { filename: file.name },
    })
  } catch (error) {
    console.error(`[${req.requestId}] Download error:`, error)
    res.status(500).json({ error: "Download failed" })
  }
})

// Delete file
router.delete("/:id", async (req, res) => {
  try {
    console.log(`[${req.requestId}] Delete request for file:`, req.params.id)

    // Find the file
    const fileIndex = uploadedFiles.findIndex((f) => f.id === req.params.id && f.userId === req.user.id)

    if (fileIndex === -1) {
      console.log(`[${req.requestId}] File not found for deletion:`, req.params.id)
      return res.status(404).json({ error: "File not found" })
    }

    const file = uploadedFiles[fileIndex]
    console.log(`[${req.requestId}] Deleting file:`, file.name)

    // Delete from disk
    try {
      await fs.unlink(file.filePath)
      console.log(`[${req.requestId}] File deleted from disk:`, file.filePath)
    } catch (error) {
      console.warn(`[${req.requestId}] Could not delete file from disk:`, error.message)
    }

    // Remove from memory
    uploadedFiles.splice(fileIndex, 1)

    await auditLogger.log({
      userId: req.user.id,
      action: "file_delete",
      resource: `/files/${req.params.id}`,
      ipAddress: req.clientIP,
      userAgent: req.get("User-Agent"),
      success: true,
      details: { filename: file.name },
    })

    console.log(`[${req.requestId}] File deleted successfully:`, file.name)
    res.json({ success: true, message: "File deleted successfully" })
  } catch (error) {
    console.error(`[${req.requestId}] Delete error:`, error)
    res.status(500).json({ error: "Delete failed" })
  }
})

// Share file
router.post("/:id/share", async (req, res) => {
  try {
    console.log(`[${req.requestId}] Share request for file:`, req.params.id)

    const file = uploadedFiles.find((f) => f.id === req.params.id && f.userId === req.user.id)

    if (!file) {
      return res.status(404).json({ error: "File not found" })
    }

    // Generate share token
    const shareToken = crypto.randomBytes(32).toString("hex")
    const shareUrl = `${process.env.FRONTEND_URL}/shared/${shareToken}`

    // Mark file as shared
    file.shared = true
    file.shareToken = shareToken
    file.shareOptions = req.body

    console.log(`[${req.requestId}] File shared:`, file.name)

    res.json({
      success: true,
      shareUrl,
      shareToken,
      expiresAt: req.body.expirationDate || null,
    })
  } catch (error) {
    console.error(`[${req.requestId}] Share error:`, error)
    res.status(500).json({ error: "Share failed" })
  }
})

// Preview endpoint
router.get("/:id/preview", async (req, res) => {
  try {
    console.log(`[${req.requestId}] Preview request for file:`, req.params.id)

    const file = uploadedFiles.find((f) => f.id === req.params.id && f.userId === req.user.id)

    if (!file) {
      return res.status(404).json({ error: "File not found" })
    }

    // Check if file type supports preview
    const previewableTypes = ["image/", "text/", "application/pdf"]
    const canPreview = previewableTypes.some((type) => file.type.startsWith(type))

    if (!canPreview) {
      return res.status(400).json({ error: "File type not supported for preview" })
    }

    // Send file for preview
    res.sendFile(path.resolve(file.filePath))
  } catch (error) {
    console.error(`[${req.requestId}] Preview error:`, error)
    res.status(500).json({ error: "Preview failed" })
  }
})

module.exports = router
