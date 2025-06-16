const express = require("express")
const multer = require("multer")
const path = require("path")
const fs = require("fs").promises
const crypto = require("crypto")

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
      return crypto.createHash("sha256").update(fileBuffer).digest("hex")
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
<<<<<<< Updated upstream
    console.log(`[${req.requestId}] Getting files for user:`, userId)
=======
    const searchQuery = req.query.search
    const parentFolderId = req.query.parentFolderId || null
    console.log(`[${req.requestId}] Getting files for user:`, userId, "search:", searchQuery, "parentFolderId:", parentFolderId)
>>>>>>> Stashed changes

    // Get files from Supabase
    const { data: files, error } = await supabase
      .from("files")
      .select("*")
      .eq("user_id", userId)
      .eq("deleted", false)
<<<<<<< Updated upstream
      .order("created_at", { ascending: false })
=======

    // Filter by parent folder if specified
    if (parentFolderId) {
      query = query.eq("parent_folder_id", parentFolderId)
    } else {
      // If no parent folder specified, get root level items (no parent)
      query = query.is("parent_folder_id", null)
    }

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
      // No search - default sorting: folders first, then files, then by name
      query = query.order("is_folder", { ascending: false })
        .order("original_name", { ascending: true })
    }

    const { data: files, error } = await query
>>>>>>> Stashed changes

    if (error) {
      console.error(`[${req.requestId}] Supabase error:`, error)
      throw error
    }

    console.log(`[${req.requestId}] Found ${files.length} items for user`)

    // Transform file data for frontend
    const transformedFiles = files.map((file) => ({
      id: file.id,
      name: file.original_name,
      size: file.size,
      type: file.mime_type,
      isFolder: file.is_folder || false,
      parentFolderId: file.parent_folder_id,
      folderPath: file.folder_path,
      folderDepth: file.folder_depth,
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
<<<<<<< Updated upstream
      details: { count: files.length },
=======
      details: { 
        count: files.length,
        searchQuery: searchQuery || null,
        parentFolderId: parentFolderId || null
      },
>>>>>>> Stashed changes
      created_at: new Date().toISOString(),
    })

    res.json({ data: transformedFiles })
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

      const supabase = req.app.locals.supabase
      const userId = req.user.id
      const uploadOptions = JSON.parse(req.body.options || "{}")
<<<<<<< Updated upstream
=======
      const encryptionPassword = req.body.encryptionPassword || req.user.email // Use email as default password
      const parentFolderId = req.body.parentFolderId || null
>>>>>>> Stashed changes

      console.log(`[${req.requestId}] Upload options:`, uploadOptions, "parentFolderId:", parentFolderId)

      // Validate parent folder if specified
      if (parentFolderId) {
        const { data: parentFolder, error: parentError } = await supabase
          .from("files")
          .select("id, is_folder")
          .eq("id", parentFolderId)
          .eq("user_id", userId)
          .eq("deleted", false)
          .single()

        if (parentError || !parentFolder) {
          return res.status(404).json({ error: "Parent folder not found" })
        }

        if (!parentFolder.is_folder) {
          return res.status(400).json({ error: "Parent must be a folder" })
        }
      }

      // Check for name conflicts in the target folder
      const { data: existingFile, error: existingError } = await supabase
        .from("files")
        .select("id")
        .eq("user_id", userId)
        .eq("original_name", req.file.originalname)
        .eq("parent_folder_id", parentFolderId)
        .eq("deleted", false)
        .single()

      if (existingFile) {
        return res.status(409).json({ error: "A file with this name already exists in this location" })
      }

      // Validate file integrity
      console.log(`[${req.requestId}] Calculating file hash...`)
      const fileHash = await fileValidator.calculateHash(req.file.path)
      console.log(`[${req.requestId}] File hash:`, fileHash)

      // Upload file to Supabase Storage
      const fileBuffer = await fs.readFile(req.file.path)
      const fileExt = path.extname(req.file.originalname)
      const fileName = `${userId}/${crypto.randomUUID()}${fileExt}`

      const { data: storageData, error: storageError } = await supabase.storage
        .from("secure-files")
        .upload(fileName, fileBuffer, {
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
<<<<<<< Updated upstream
          encrypted: uploadOptions.encryption || false,
          encryption_key: uploadOptions.encryption ? crypto.randomBytes(32).toString("hex") : null,
=======
          is_folder: false,
          parent_folder_id: parentFolderId,
          encrypted: uploadOptions.encryption !== false,
          encryption_metadata: encryptionMetadata,
>>>>>>> Stashed changes
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
<<<<<<< Updated upstream
=======
        encrypted: fileRecord.encrypted,
        parentFolderId: fileRecord.parent_folder_id,
>>>>>>> Stashed changes
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
<<<<<<< Updated upstream
          encrypted: uploadOptions.encryption || false,
=======
          encrypted: fileRecord.encrypted,
          encryptionAlgorithm: encryptionMetadata?.algorithm || "none",
          parentFolderId: parentFolderId,
>>>>>>> Stashed changes
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
<<<<<<< Updated upstream
=======
          isFolder: false,
          parentFolderId: fileRecord.parent_folder_id,
          folderPath: fileRecord.folder_path,
          encrypted: fileRecord.encrypted,
>>>>>>> Stashed changes
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
    const supabase = req.app.locals.supabase
    const userId = req.user.id
    const fileId = req.params.id

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

    // Download file from storage
    const { data: fileData, error: storageError } = await supabase.storage
      .from("secure-files")
      .download(file.stored_name)

    if (storageError) {
      console.error(`[${req.requestId}] Storage error:`, storageError)
      throw storageError
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
      details: { filename: file.original_name },
      created_at: new Date().toISOString(),
    })

    // Set response headers
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(file.original_name)}"`)
    res.setHeader("Content-Type", file.mime_type)

    // Send file
    const buffer = await fileData.arrayBuffer()
    res.send(Buffer.from(buffer))

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

// Preview endpoint
router.get("/:id/preview", async (req, res) => {
  try {
    const supabase = req.app.locals.supabase
    const userId = req.user.id
    const fileId = req.params.id

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

    // Download file from storage
    const { data: fileData, error: storageError } = await supabase.storage
      .from("secure-files")
      .download(file.stored_name)

    if (storageError) {
      console.error(`[${req.requestId}] Storage error:`, storageError)
      throw storageError
    }

    // Set response headers
    res.setHeader("Content-Type", file.mime_type)

    // Send file for preview
    const buffer = await fileData.arrayBuffer()
    res.send(Buffer.from(buffer))

    console.log(`[${req.requestId}] Preview successful:`, file.original_name)
  } catch (error) {
    console.error(`[${req.requestId}] Preview error:`, error)
    res.status(500).json({ error: "Preview failed" })
  }
})

// ==================== FOLDER MANAGEMENT ENDPOINTS ====================

// Create a new folder
router.post("/folders", async (req, res) => {
  try {
    const supabase = req.app.locals.supabase
    const userId = req.user.id
    const { name, parentFolderId } = req.body

    console.log(`[${req.requestId}] Create folder request:`, { name, parentFolderId })

    // Validate folder name
    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: "Folder name is required" })
    }

    // Check for invalid characters in folder name
    const invalidChars = /[<>:"/\\|?*]/
    if (invalidChars.test(name)) {
      return res.status(400).json({ 
        error: "Folder name contains invalid characters. Cannot use: < > : \" / \\ | ? *" 
      })
    }

    // Check if parent folder exists and belongs to user
    if (parentFolderId) {
      const { data: parentFolder, error: parentError } = await supabase
        .from("files")
        .select("id, is_folder")
        .eq("id", parentFolderId)
        .eq("user_id", userId)
        .eq("deleted", false)
        .single()

      if (parentError || !parentFolder) {
        return res.status(404).json({ error: "Parent folder not found" })
      }

      if (!parentFolder.is_folder) {
        return res.status(400).json({ error: "Parent must be a folder" })
      }
    }

    // Check if folder with same name already exists in the same location
    const { data: existingFolder, error: existingError } = await supabase
      .from("files")
      .select("id")
      .eq("user_id", userId)
      .eq("original_name", name.trim())
      .eq("is_folder", true)
      .eq("parent_folder_id", parentFolderId)
      .eq("deleted", false)
      .single()

    if (existingFolder) {
      return res.status(409).json({ error: "A folder with this name already exists in this location" })
    }

    // Create folder record
    const { data: folder, error: createError } = await supabase
      .from("files")
      .insert({
        user_id: userId,
        original_name: name.trim(),
        stored_name: `folder_${generateSecureToken()}`, // Placeholder for folder
        size: 0, // Folders have no size
        mime_type: "application/x-directory",
        is_folder: true,
        parent_folder_id: parentFolderId,
        encrypted: false, // Folders are not encrypted
        shared: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (createError) {
      console.error(`[${req.requestId}] Folder creation error:`, createError)
      throw createError
    }

    // Log audit
    await supabase.from("audit_logs").insert({
      user_id: userId,
      action: "folder_create",
      resource: `/files/folders/${folder.id}`,
      ip_address: req.clientIP,
      user_agent: req.get("User-Agent"),
      success: true,
      details: {
        folderName: folder.original_name,
        parentFolderId: parentFolderId,
        folderPath: folder.folder_path
      },
      created_at: new Date().toISOString(),
    })

    console.log(`[${req.requestId}] Folder created successfully:`, folder.original_name)

    res.json({
      success: true,
      folder: {
        id: folder.id,
        name: folder.original_name,
        isFolder: true,
        parentFolderId: folder.parent_folder_id,
        folderPath: folder.folder_path,
        folderDepth: folder.folder_depth,
        createdAt: folder.created_at,
        updatedAt: folder.updated_at
      }
    })
  } catch (error) {
    console.error(`[${req.requestId}] Folder creation error:`, error)
    res.status(500).json({ error: "Failed to create folder" })
  }
})

// Get folder tree structure
router.get("/folders/tree", async (req, res) => {
  try {
    const supabase = req.app.locals.supabase
    const userId = req.user.id
    const { parentFolderId } = req.query

    console.log(`[${req.requestId}] Get folder tree request:`, { parentFolderId })

    // Use the database function to get folder tree
    const { data: items, error } = await supabase
      .rpc('get_folder_tree', {
        user_uuid: userId,
        parent_folder_uuid: parentFolderId || null
      })

    if (error) {
      console.error(`[${req.requestId}] Folder tree error:`, error)
      throw error
    }

    // Transform data for frontend
    const transformedItems = items.map(item => ({
      id: item.id,
      name: item.name,
      isFolder: item.is_folder,
      parentFolderId: item.parent_folder_id,
      folderPath: item.folder_path,
      folderDepth: item.folder_depth,
      size: item.size,
      mimeType: item.mime_type,
      createdAt: item.created_at,
      updatedAt: item.updated_at
    }))

    // Log audit
    await supabase.from("audit_logs").insert({
      user_id: userId,
      action: "folder_tree_view",
      resource: "/files/folders/tree",
      ip_address: req.clientIP,
      user_agent: req.get("User-Agent"),
      success: true,
      details: {
        parentFolderId: parentFolderId || null,
        itemCount: transformedItems.length
      },
      created_at: new Date().toISOString(),
    })

    res.json({
      success: true,
      items: transformedItems
    })
  } catch (error) {
    console.error(`[${req.requestId}] Folder tree error:`, error)
    res.status(500).json({ error: "Failed to get folder tree" })
  }
})

// Move file or folder to different location
router.put("/:id/move", async (req, res) => {
  try {
    const supabase = req.app.locals.supabase
    const userId = req.user.id
    const itemId = req.params.id
    const { targetFolderId } = req.body

    console.log(`[${req.requestId}] Move item request:`, { itemId, targetFolderId })

    // Get the item to move
    const { data: item, error: itemError } = await supabase
      .from("files")
      .select("*")
      .eq("id", itemId)
      .eq("user_id", userId)
      .eq("deleted", false)
      .single()

    if (itemError || !item) {
      return res.status(404).json({ error: "Item not found" })
    }

    // Validate target folder if provided
    if (targetFolderId) {
      const { data: targetFolder, error: targetError } = await supabase
        .from("files")
        .select("id, is_folder")
        .eq("id", targetFolderId)
        .eq("user_id", userId)
        .eq("deleted", false)
        .single()

      if (targetError || !targetFolder) {
        return res.status(404).json({ error: "Target folder not found" })
      }

      if (!targetFolder.is_folder) {
        return res.status(400).json({ error: "Target must be a folder" })
      }

      // Prevent moving a folder into itself or its descendants
      if (item.is_folder) {
        const { data: descendants } = await supabase
          .from("files")
          .select("id")
          .eq("user_id", userId)
          .like("folder_path", item.folder_path + "/%")
          .eq("deleted", false)

        if (descendants && descendants.some(desc => desc.id === targetFolderId)) {
          return res.status(400).json({ error: "Cannot move folder into its own subfolder" })
        }
      }
    }

    // Check for name conflicts in target location
    const { data: existingItem, error: existingError } = await supabase
      .from("files")
      .select("id")
      .eq("user_id", userId)
      .eq("original_name", item.original_name)
      .eq("parent_folder_id", targetFolderId)
      .eq("deleted", false)
      .single()

    if (existingItem) {
      return res.status(409).json({ error: "An item with this name already exists in the target location" })
    }

    // Update the item's parent folder
    const { error: updateError } = await supabase
      .from("files")
      .update({
        parent_folder_id: targetFolderId,
        updated_at: new Date().toISOString()
      })
      .eq("id", itemId)

    if (updateError) {
      console.error(`[${req.requestId}] Move error:`, updateError)
      throw updateError
    }

    // Get updated item
    const { data: updatedItem, error: updatedError } = await supabase
      .from("files")
      .select("*")
      .eq("id", itemId)
      .single()

    if (updatedError) {
      throw updatedError
    }

    // Log audit
    await supabase.from("audit_logs").insert({
      user_id: userId,
      action: "item_move",
      resource: `/files/${itemId}/move`,
      ip_address: req.clientIP,
      user_agent: req.get("User-Agent"),
      success: true,
      details: {
        itemName: item.original_name,
        itemType: item.is_folder ? "folder" : "file",
        oldParentId: item.parent_folder_id,
        newParentId: targetFolderId,
        newPath: updatedItem.folder_path
      },
      created_at: new Date().toISOString(),
    })

    console.log(`[${req.requestId}] Item moved successfully:`, item.original_name)

    res.json({
      success: true,
      item: {
        id: updatedItem.id,
        name: updatedItem.original_name,
        isFolder: updatedItem.is_folder,
        parentFolderId: updatedItem.parent_folder_id,
        folderPath: updatedItem.folder_path,
        folderDepth: updatedItem.folder_depth,
        updatedAt: updatedItem.updated_at
      }
    })
  } catch (error) {
    console.error(`[${req.requestId}] Move error:`, error)
    res.status(500).json({ error: "Failed to move item" })
  }
})

// Rename file or folder
router.put("/:id/rename", async (req, res) => {
  try {
    const supabase = req.app.locals.supabase
    const userId = req.user.id
    const itemId = req.params.id
    const { newName } = req.body

    console.log(`[${req.requestId}] Rename item request:`, { itemId, newName })

    // Validate new name
    if (!newName || newName.trim().length === 0) {
      return res.status(400).json({ error: "New name is required" })
    }

    // Check for invalid characters
    const invalidChars = /[<>:"/\\|?*]/
    if (invalidChars.test(newName)) {
      return res.status(400).json({ 
        error: "Name contains invalid characters. Cannot use: < > : \" / \\ | ? *" 
      })
    }

    // Get the item to rename
    const { data: item, error: itemError } = await supabase
      .from("files")
      .select("*")
      .eq("id", itemId)
      .eq("user_id", userId)
      .eq("deleted", false)
      .single()

    if (itemError || !item) {
      return res.status(404).json({ error: "Item not found" })
    }

    // Check for name conflicts in same location
    const { data: existingItem, error: existingError } = await supabase
      .from("files")
      .select("id")
      .eq("user_id", userId)
      .eq("original_name", newName.trim())
      .eq("parent_folder_id", item.parent_folder_id)
      .eq("deleted", false)
      .single()

    if (existingItem) {
      return res.status(409).json({ error: "An item with this name already exists in this location" })
    }

    // Update the item's name
    const { error: updateError } = await supabase
      .from("files")
      .update({
        original_name: newName.trim(),
        updated_at: new Date().toISOString()
      })
      .eq("id", itemId)

    if (updateError) {
      console.error(`[${req.requestId}] Rename error:`, updateError)
      throw updateError
    }

    // Get updated item
    const { data: updatedItem, error: updatedError } = await supabase
      .from("files")
      .select("*")
      .eq("id", itemId)
      .single()

    if (updatedError) {
      throw updatedError
    }

    // Log audit
    await supabase.from("audit_logs").insert({
      user_id: userId,
      action: "item_rename",
      resource: `/files/${itemId}/rename`,
      ip_address: req.clientIP,
      user_agent: req.get("User-Agent"),
      success: true,
      details: {
        oldName: item.original_name,
        newName: updatedItem.original_name,
        itemType: item.is_folder ? "folder" : "file"
      },
      created_at: new Date().toISOString(),
    })

    console.log(`[${req.requestId}] Item renamed successfully:`, item.original_name, "→", updatedItem.original_name)

    res.json({
      success: true,
      item: {
        id: updatedItem.id,
        name: updatedItem.original_name,
        isFolder: updatedItem.is_folder,
        parentFolderId: updatedItem.parent_folder_id,
        folderPath: updatedItem.folder_path,
        folderDepth: updatedItem.folder_depth,
        updatedAt: updatedItem.updated_at
      }
    })
  } catch (error) {
    console.error(`[${req.requestId}] Rename error:`, error)
    res.status(500).json({ error: "Failed to rename item" })
  }
})

// Get folder breadcrumb navigation
router.get("/folders/:id/breadcrumb", async (req, res) => {
  try {
    const supabase = req.app.locals.supabase
    const userId = req.user.id
    const folderId = req.params.id

    console.log(`[${req.requestId}] Get breadcrumb request for folder:`, folderId)

    // Get the folder and its path
    const { data: folder, error: folderError } = await supabase
      .from("files")
      .select("id, original_name, folder_path, parent_folder_id")
      .eq("id", folderId)
      .eq("user_id", userId)
      .eq("is_folder", true)
      .eq("deleted", false)
      .single()

    if (folderError || !folder) {
      return res.status(404).json({ error: "Folder not found" })
    }

    // Build breadcrumb from folder path
    const pathParts = folder.folder_path.split('/').filter(part => part.length > 0)
    const breadcrumb = []

    // Add root
    breadcrumb.push({
      id: null,
      name: "Root",
      path: "/"
    })

    // Build breadcrumb for each path level
    let currentPath = ""
    for (let i = 0; i < pathParts.length; i++) {
      currentPath += "/" + pathParts[i]
      
      // Get folder ID for this path level
      const { data: pathFolder } = await supabase
        .from("files")
        .select("id")
        .eq("user_id", userId)
        .eq("folder_path", currentPath)
        .eq("is_folder", true)
        .eq("deleted", false)
        .single()

      breadcrumb.push({
        id: pathFolder?.id || null,
        name: pathParts[i],
        path: currentPath
      })
    }

    res.json({
      success: true,
      breadcrumb: breadcrumb
    })
  } catch (error) {
    console.error(`[${req.requestId}] Breadcrumb error:`, error)
    res.status(500).json({ error: "Failed to get breadcrumb" })
  }
})

module.exports = router
