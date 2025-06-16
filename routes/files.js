const express = require("express")
const multer = require("multer")
const path = require("path")
const fs = require("fs").promises
const crypto = require("crypto")
const { 
  encryptFileBuffer, 
  decryptFileBuffer, 
  generateFileHash, 
  generateSecureToken 
} = require("../utils/crypto")

const router = express.Router()

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
      return generateFileHash(fileBuffer)
    } catch (error) {
      console.error("Hash calculation error:", error)
      throw error
    }
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
    const supabase = req.app.locals.supabase
    const userId = req.user.id
    const searchQuery = req.query.search
    console.log(`[${req.requestId}] Getting files for user:`, userId, "search:", searchQuery)

    // Build the query
    let query = supabase
      .from("files")
      .select("*")
      .eq("user_id", userId)
      .eq("deleted", false)

    // Apply search filter if provided
    if (searchQuery && searchQuery.trim()) {
      console.log(`[${req.requestId}] Applying search filter:`, searchQuery)
      
      // Parse search query if it's JSON (from frontend filters)
      let searchFilters = {}
      try {
        if (searchQuery.startsWith('{')) {
          searchFilters = JSON.parse(searchQuery)
        } else {
          // Simple text search
          searchFilters = { query: searchQuery }
        }
      } catch (e) {
        // If JSON parsing fails, treat as simple text search
        searchFilters = { query: searchQuery }
      }

      // Apply text search on file name
      if (searchFilters.query) {
        query = query.ilike("original_name", `%${searchFilters.query}%`)
      }

      // Apply file type filter
      if (searchFilters.type && searchFilters.type !== "all") {
        const mimeTypeMap = {
          image: "image/",
          document: ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/"],
          video: "video/",
          audio: "audio/",
          archive: ["application/zip", "application/x-rar-compressed", "application/x-7z-compressed"]
        }

        const typeFilter = mimeTypeMap[searchFilters.type]
        if (typeFilter) {
          if (Array.isArray(typeFilter)) {
            // Multiple MIME types for this category
            const orConditions = typeFilter.map(type => `mime_type.ilike.${type}%`).join(',')
            query = query.or(orConditions)
          } else {
            // Single MIME type prefix
            query = query.ilike("mime_type", `${typeFilter}%`)
          }
        }
      }

      // Apply sorting
      if (searchFilters.sortBy) {
        const sortOrder = searchFilters.sortOrder === "desc" ? { ascending: false } : { ascending: true }
        
        switch (searchFilters.sortBy) {
          case "name":
            query = query.order("original_name", sortOrder)
            break
          case "size":
            query = query.order("size", sortOrder)
            break
          case "date":
            query = query.order("created_at", sortOrder)
            break
          case "type":
            query = query.order("mime_type", sortOrder)
            break
          default:
            query = query.order("created_at", { ascending: false })
        }
      } else {
        // Default sorting by creation date
        query = query.order("created_at", { ascending: false })
      }
    } else {
      // No search - default sorting by creation date
      query = query.order("created_at", { ascending: false })
    }

    const { data: files, error } = await query

    if (error) {
      console.error(`[${req.requestId}] Supabase error:`, error)
      throw error
    }

    console.log(`[${req.requestId}] Found ${files.length} files for user`)

    // Transform file data for frontend
    const transformedFiles = files.map((file) => ({
      id: file.id,
      name: file.original_name,
      size: file.size,
      type: file.mime_type,
      uploadedAt: file.created_at,
      encrypted: file.encrypted,
      shared: file.shared,
      accessControl: file.access_control,
      downloadCount: file.download_count,
      lastAccessed: file.last_accessed,
    }))

    // Log audit
    await supabase.from("audit_logs").insert({
      user_id: userId,
      action: "files_list",
      resource: "/files",
      ip_address: req.clientIP,
      user_agent: req.get("User-Agent"),
      success: true,
      details: { 
        count: files.length,
        searchQuery: searchQuery || null
      },
      created_at: new Date().toISOString(),
    })

    res.json({ data: transformedFiles })
  } catch (error) {
    console.error(`[${req.requestId}] Failed to fetch files:`, error)
    res.status(500).json({ error: "Failed to fetch files" })
  }
})

// Upload file with encryption
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

      const supabase = req.app.locals.supabase
      const userId = req.user.id
      const uploadOptions = JSON.parse(req.body.options || "{}")
      const encryptionPassword = req.body.encryptionPassword || req.user.email // Use email as default password

      console.log(`[${req.requestId}] Upload options:`, uploadOptions)

      // Read the uploaded file
      const fileBuffer = await fs.readFile(req.file.path)
      
      // Calculate file hash
      console.log(`[${req.requestId}] Calculating file hash...`)
      const fileHash = generateFileHash(fileBuffer)
      console.log(`[${req.requestId}] File hash:`, fileHash)

      let encryptedBuffer = fileBuffer
      let encryptionMetadata = null

      // Encrypt file if encryption is enabled
      if (uploadOptions.encryption !== false) {
        console.log(`[${req.requestId}] Encrypting file...`)
        const encryptionResult = await encryptFileBuffer(fileBuffer, encryptionPassword)
        encryptedBuffer = encryptionResult.encryptedData
        encryptionMetadata = {
          salt: encryptionResult.salt,
          iv: encryptionResult.iv,
          tag: encryptionResult.tag,
          algorithm: "aes-256-gcm"
        }
        console.log(`[${req.requestId}] File encrypted successfully`)
      }

      // Upload encrypted file to Supabase Storage
      const fileExt = path.extname(req.file.originalname)
      const fileName = `${userId}/${generateSecureToken()}${fileExt}`

      const { data: storageData, error: storageError } = await supabase.storage
        .from("secure-files")
        .upload(fileName, encryptedBuffer, {
          contentType: req.file.mimetype,
          cacheControl: "3600",
        })

      if (storageError) {
        console.error(`[${req.requestId}] Storage error:`, storageError)
        throw storageError
      }

      console.log(`[${req.requestId}] File uploaded to storage:`, storageData.path)

      // Create file record in database
      const { data: fileRecord, error: dbError } = await supabase
        .from("files")
        .insert({
          user_id: userId,
          original_name: req.file.originalname,
          stored_name: fileName,
          size: req.file.size,
          mime_type: req.file.mimetype,
          encrypted: uploadOptions.encryption !== false,
          encryption_metadata: encryptionMetadata,
          file_hash: fileHash,
          shared: false,
          access_control: uploadOptions.accessControl || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select()
        .single()

      if (dbError) {
        console.error(`[${req.requestId}] Database error:`, dbError)
        throw dbError
      }

      console.log(`[${req.requestId}] File record created:`, {
        id: fileRecord.id,
        name: fileRecord.original_name,
        size: fileRecord.size,
        encrypted: fileRecord.encrypted,
      })

      // Log audit
      await supabase.from("audit_logs").insert({
        user_id: userId,
        action: "file_upload",
        resource: `/files/${fileRecord.id}`,
        ip_address: req.clientIP,
        user_agent: req.get("User-Agent"),
        success: true,
        details: {
          filename: req.file.originalname,
          size: req.file.size,
          encrypted: fileRecord.encrypted,
          encryptionAlgorithm: encryptionMetadata?.algorithm || "none",
        },
        created_at: new Date().toISOString(),
      })

      // Clean up local file
      await fs.unlink(req.file.path)
      console.log(`[${req.requestId}] Local file deleted:`, req.file.path)

      console.log(`[${req.requestId}] Upload successful`)

      res.json({
        success: true,
        file: {
          id: fileRecord.id,
          name: fileRecord.original_name,
          size: fileRecord.size,
          type: fileRecord.mime_type,
          encrypted: fileRecord.encrypted,
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

// Download endpoint with decryption
router.get("/:id/download", async (req, res) => {
  try {
    const supabase = req.app.locals.supabase
    const userId = req.user.id
    const fileId = req.params.id
    const decryptionPassword = req.query.password || req.user.email // Use email as default password

    console.log(`[${req.requestId}] Download request for file:`, fileId)

    // Get file metadata from database
    const { data: file, error: dbError } = await supabase
      .from("files")
      .select("*")
      .eq("id", fileId)
      .eq("user_id", userId)
      .eq("deleted", false)
      .single()

    if (dbError || !file) {
      console.log(`[${req.requestId}] File not found:`, fileId)
      return res.status(404).json({ error: "File not found" })
    }

    console.log(`[${req.requestId}] Found file:`, file.original_name)

    // Download encrypted file from storage
    const { data: encryptedData, error: storageError } = await supabase.storage
      .from("secure-files")
      .download(file.stored_name)

    if (storageError) {
      console.error(`[${req.requestId}] Storage error:`, storageError)
      throw storageError
    }

    let decryptedBuffer = encryptedData

    // Decrypt file if it's encrypted
    if (file.encrypted) {
      console.log(`[${req.requestId}] Decrypting file...`)
      try {
        const encryptedBuffer = Buffer.from(await encryptedData.arrayBuffer())
        decryptedBuffer = await decryptFileBuffer(encryptedBuffer, decryptionPassword)
        console.log(`[${req.requestId}] File decrypted successfully`)
      } catch (decryptError) {
        console.error(`[${req.requestId}] Decryption error:`, decryptError)
        return res.status(400).json({ 
          error: "Failed to decrypt file. Please check your password.",
          details: "The file is encrypted and the provided password is incorrect."
        })
      }
    }

    // Update download count and last accessed
    await supabase
      .from("files")
      .update({
        download_count: (file.download_count || 0) + 1,
        last_accessed: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", fileId)

    // Log audit
    await supabase.from("audit_logs").insert({
      user_id: userId,
      action: "file_download",
      resource: `/files/${fileId}`,
      ip_address: req.clientIP,
      user_agent: req.get("User-Agent"),
      success: true,
      details: { 
        filename: file.original_name,
        encrypted: file.encrypted,
        decryptionSuccess: true
      },
      created_at: new Date().toISOString(),
    })

    // Set response headers
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(file.original_name)}"`)
    res.setHeader("Content-Type", file.mime_type)

    // Send decrypted file
    res.send(decryptedBuffer)

    console.log(`[${req.requestId}] Download successful:`, file.original_name)
  } catch (error) {
    console.error(`[${req.requestId}] Download error:`, error)
    res.status(500).json({ error: "Download failed" })
  }
})

// Delete file
router.delete("/:id", async (req, res) => {
  try {
    const supabase = req.app.locals.supabase
    const userId = req.user.id
    const fileId = req.params.id

    console.log(`[${req.requestId}] Delete request for file:`, fileId)

    // Get file metadata
    const { data: file, error: dbError } = await supabase
      .from("files")
      .select("*")
      .eq("id", fileId)
      .eq("user_id", userId)
      .eq("deleted", false)
      .single()

    if (dbError || !file) {
      console.log(`[${req.requestId}] File not found for deletion:`, fileId)
      return res.status(404).json({ error: "File not found" })
    }

    console.log(`[${req.requestId}] Deleting file:`, file.original_name)

    // Soft delete in database
    await supabase
      .from("files")
      .update({
        deleted: true,
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", fileId)

    // Log audit
    await supabase.from("audit_logs").insert({
      user_id: userId,
      action: "file_delete",
      resource: `/files/${fileId}`,
      ip_address: req.clientIP,
      user_agent: req.get("User-Agent"),
      success: true,
      details: { filename: file.original_name },
      created_at: new Date().toISOString(),
    })

    console.log(`[${req.requestId}] File deleted successfully:`, file.original_name)
    res.json({ success: true, message: "File deleted successfully" })
  } catch (error) {
    console.error(`[${req.requestId}] Delete error:`, error)
    res.status(500).json({ error: "Delete failed" })
  }
})

// Share file
router.post("/:id/share", async (req, res) => {
  try {
    const supabase = req.app.locals.supabase
    const userId = req.user.id
    const fileId = req.params.id

    console.log(`[${req.requestId}] Share request for file:`, fileId)

    // Get file metadata
    const { data: file, error: dbError } = await supabase
      .from("files")
      .select("*")
      .eq("id", fileId)
      .eq("user_id", userId)
      .eq("deleted", false)
      .single()

    if (dbError || !file) {
      return res.status(404).json({ error: "File not found" })
    }

    // Generate share token
    const shareToken = crypto.randomBytes(32).toString("hex")
    const shareUrl = `${process.env.FRONTEND_URL}/shared/${shareToken}`

    // Update file with share info
    await supabase
      .from("files")
      .update({
        shared: true,
        share_token: shareToken,
        share_expires_at: req.body.expirationDate ? new Date(req.body.expirationDate).toISOString() : null,
        access_control: {
          ...file.access_control,
          shareOptions: req.body,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", fileId)

    console.log(`[${req.requestId}] File shared:`, file.original_name)

    // Log audit
    await supabase.from("audit_logs").insert({
      user_id: userId,
      action: "file_share",
      resource: `/files/${fileId}`,
      ip_address: req.clientIP,
      user_agent: req.get("User-Agent"),
      success: true,
      details: {
        filename: file.original_name,
        shareToken: shareToken,
        expirationDate: req.body.expirationDate || null,
      },
      created_at: new Date().toISOString(),
    })

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

// Preview endpoint with decryption support
router.get("/:id/preview", async (req, res) => {
  try {
    const supabase = req.app.locals.supabase
    const userId = req.user.id
    const fileId = req.params.id
    const decryptionPassword = req.query.password || req.user.email

    console.log(`[${req.requestId}] Preview request for file:`, fileId)

    // Get file metadata
    const { data: file, error: dbError } = await supabase
      .from("files")
      .select("*")
      .eq("id", fileId)
      .eq("user_id", userId)
      .eq("deleted", false)
      .single()

    if (dbError || !file) {
      return res.status(404).json({ error: "File not found" })
    }

    // Check if file type supports preview
    const previewableTypes = ["image/", "text/", "application/pdf"]
    const canPreview = previewableTypes.some((type) => file.mime_type.startsWith(type))

    if (!canPreview) {
      return res.status(400).json({ error: "File type not supported for preview" })
    }

    // Download encrypted file from storage
    const { data: encryptedData, error: storageError } = await supabase.storage
      .from("secure-files")
      .download(file.stored_name)

    if (storageError) {
      console.error(`[${req.requestId}] Storage error:`, storageError)
      throw storageError
    }

    let decryptedBuffer = encryptedData

    // Decrypt file if it's encrypted
    if (file.encrypted) {
      console.log(`[${req.requestId}] Decrypting file for preview...`)
      try {
        const encryptedBuffer = Buffer.from(await encryptedData.arrayBuffer())
        decryptedBuffer = await decryptFileBuffer(encryptedBuffer, decryptionPassword)
        console.log(`[${req.requestId}] File decrypted for preview`)
      } catch (decryptError) {
        console.error(`[${req.requestId}] Preview decryption error:`, decryptError)
        return res.status(400).json({ 
          error: "Failed to decrypt file for preview. Please check your password.",
          details: "The file is encrypted and the provided password is incorrect."
        })
      }
    }

    // Set response headers
    res.setHeader("Content-Type", file.mime_type)

    // Send decrypted file for preview
    res.send(decryptedBuffer)

    console.log(`[${req.requestId}] Preview successful:`, file.original_name)
  } catch (error) {
    console.error(`[${req.requestId}] Preview error:`, error)
    res.status(500).json({ error: "Preview failed" })
  }
})

// Encrypt existing file
router.post("/:id/encrypt", async (req, res) => {
  try {
    const supabase = req.app.locals.supabase
    const userId = req.user.id
    const fileId = req.params.id
    const encryptionPassword = req.body.password || req.user.email

    console.log(`[${req.requestId}] Encrypt request for file:`, fileId)

    // Get file metadata
    const { data: file, error: dbError } = await supabase
      .from("files")
      .select("*")
      .eq("id", fileId)
      .eq("user_id", userId)
      .eq("deleted", false)
      .single()

    if (dbError || !file) {
      return res.status(404).json({ error: "File not found" })
    }

    if (file.encrypted) {
      return res.status(400).json({ error: "File is already encrypted" })
    }

    // Download unencrypted file from storage
    const { data: fileData, error: storageError } = await supabase.storage
      .from("secure-files")
      .download(file.stored_name)

    if (storageError) {
      console.error(`[${req.requestId}] Storage error:`, storageError)
      throw storageError
    }

    // Encrypt the file
    console.log(`[${req.requestId}] Encrypting file...`)
    const fileBuffer = Buffer.from(await fileData.arrayBuffer())
    const encryptionResult = await encryptFileBuffer(fileBuffer, encryptionPassword)
    
    const encryptionMetadata = {
      salt: encryptionResult.salt,
      iv: encryptionResult.iv,
      tag: encryptionResult.tag,
      algorithm: "aes-256-gcm"
    }

    // Upload encrypted file back to storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("secure-files")
      .upload(file.stored_name, encryptionResult.encryptedData, {
        contentType: file.mime_type,
        cacheControl: "3600",
        upsert: true
      })

    if (uploadError) {
      console.error(`[${req.requestId}] Upload error:`, uploadError)
      throw uploadError
    }

    // Update file record
    await supabase
      .from("files")
      .update({
        encrypted: true,
        encryption_metadata: encryptionMetadata,
        updated_at: new Date().toISOString(),
      })
      .eq("id", fileId)

    // Log audit
    await supabase.from("audit_logs").insert({
      user_id: userId,
      action: "file_encrypt",
      resource: `/files/${fileId}`,
      ip_address: req.clientIP,
      user_agent: req.get("User-Agent"),
      success: true,
      details: {
        filename: file.original_name,
        encryptionAlgorithm: "aes-256-gcm"
      },
      created_at: new Date().toISOString(),
    })

    console.log(`[${req.requestId}] File encrypted successfully:`, file.original_name)
    res.json({ 
      success: true, 
      message: "File encrypted successfully",
      file: {
        id: file.id,
        name: file.original_name,
        encrypted: true
      }
    })
  } catch (error) {
    console.error(`[${req.requestId}] Encryption error:`, error)
    res.status(500).json({ error: "Encryption failed" })
  }
})

// Decrypt existing file
router.post("/:id/decrypt", async (req, res) => {
  try {
    const supabase = req.app.locals.supabase
    const userId = req.user.id
    const fileId = req.params.id
    const decryptionPassword = req.body.password || req.user.email

    console.log(`[${req.requestId}] Decrypt request for file:`, fileId)

    // Get file metadata
    const { data: file, error: dbError } = await supabase
      .from("files")
      .select("*")
      .eq("id", fileId)
      .eq("user_id", userId)
      .eq("deleted", false)
      .single()

    if (dbError || !file) {
      return res.status(404).json({ error: "File not found" })
    }

    if (!file.encrypted) {
      return res.status(400).json({ error: "File is not encrypted" })
    }

    // Download encrypted file from storage
    const { data: encryptedData, error: storageError } = await supabase.storage
      .from("secure-files")
      .download(file.stored_name)

    if (storageError) {
      console.error(`[${req.requestId}] Storage error:`, storageError)
      throw storageError
    }

    // Decrypt the file
    console.log(`[${req.requestId}] Decrypting file...`)
    try {
      const encryptedBuffer = Buffer.from(await encryptedData.arrayBuffer())
      const decryptedBuffer = await decryptFileBuffer(encryptedBuffer, decryptionPassword)

      // Upload decrypted file back to storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("secure-files")
        .upload(file.stored_name, decryptedBuffer, {
          contentType: file.mime_type,
          cacheControl: "3600",
          upsert: true
        })

      if (uploadError) {
        console.error(`[${req.requestId}] Upload error:`, uploadError)
        throw uploadError
      }

      // Update file record
      await supabase
        .from("files")
        .update({
          encrypted: false,
          encryption_metadata: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", fileId)

      // Log audit
      await supabase.from("audit_logs").insert({
        user_id: userId,
        action: "file_decrypt",
        resource: `/files/${fileId}`,
        ip_address: req.clientIP,
        user_agent: req.get("User-Agent"),
        success: true,
        details: {
          filename: file.original_name
        },
        created_at: new Date().toISOString(),
      })

      console.log(`[${req.requestId}] File decrypted successfully:`, file.original_name)
      res.json({ 
        success: true, 
        message: "File decrypted successfully",
        file: {
          id: file.id,
          name: file.original_name,
          encrypted: false
        }
      })
    } catch (decryptError) {
      console.error(`[${req.requestId}] Decryption error:`, decryptError)
      return res.status(400).json({ 
        error: "Failed to decrypt file. Please check your password.",
        details: "The provided password is incorrect."
      })
    }
  } catch (error) {
    console.error(`[${req.requestId}] Decryption error:`, error)
    res.status(500).json({ error: "Decryption failed" })
  }
})

// Get file encryption status
router.get("/:id/encryption-status", async (req, res) => {
  try {
    const supabase = req.app.locals.supabase
    const userId = req.user.id
    const fileId = req.params.id

    console.log(`[${req.requestId}] Encryption status request for file:`, fileId)

    // Get file metadata
    const { data: file, error: dbError } = await supabase
      .from("files")
      .select("id, original_name, encrypted, encryption_metadata, created_at, updated_at")
      .eq("id", fileId)
      .eq("user_id", userId)
      .eq("deleted", false)
      .single()

    if (dbError || !file) {
      return res.status(404).json({ error: "File not found" })
    }

    res.json({
      success: true,
      file: {
        id: file.id,
        name: file.original_name,
        encrypted: file.encrypted,
        encryptionMetadata: file.encryption_metadata,
        createdAt: file.created_at,
        updatedAt: file.updated_at
      }
    })
  } catch (error) {
    console.error(`[${req.requestId}] Encryption status error:`, error)
    res.status(500).json({ error: "Failed to get encryption status" })
  }
})

module.exports = router
