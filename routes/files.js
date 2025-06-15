import crypto from 'crypto'
import express from 'express'
import { promises as fs } from 'fs'
import multer from 'multer'
import nodemailer from 'nodemailer'
import path, { dirname } from 'path'
import { fileURLToPath } from 'url'
import { FileService } from '../services/fileService.js'

const router = express.Router()

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, "../uploads")
fs.mkdir(uploadDir, { recursive: true }).catch(console.error)

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
  destination: (req, file, cb) => {
    cb(null, uploadDir)
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9)
    cb(null, uniqueSuffix + "-" + file.originalname)
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

// Get all files for user with advanced filtering and sorting
router.get("/", async (req, res) => {
  try {
    const fileService = new FileService(req.app.locals.supabase)
    const userId = req.user.id

    // Extract filters from query params
    const { query, type, sortBy, sortOrder, dateRange } = req.query

    // Fetch all files for the user
    let files = await fileService.getFiles(userId)

    // Filter by search query
    if (query) {
      files = files.filter(f =>
        f.name.toLowerCase().includes(query.toLowerCase())
      )
    }

    // Filter by type
    if (type && type !== "all") {
      files = files.filter(f => f.type.startsWith(type))
    }

    // Filter by date range
    if (dateRange && dateRange !== "all") {
      const now = new Date()
      let startDate
      switch (dateRange) {
        case "today":
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
          break
        case "week":
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
          break
        case "month":
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
          break
        case "year":
          startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
          break
        default:
          startDate = null
      }
      if (startDate) {
        files = files.filter(f => new Date(f.uploadedAt) >= startDate)
      }
    }

    // Sort
    if (sortBy) {
      files = files.sort((a, b) => {
        if (sortBy === "name") {
          return sortOrder === "desc"
            ? b.name.localeCompare(a.name)
            : a.name.localeCompare(b.name)
        }
        if (sortBy === "size") {
          return sortOrder === "desc" ? b.size - a.size : a.size - b.size
        }
        if (sortBy === "date") {
          return sortOrder === "desc"
            ? new Date(b.uploadedAt) - new Date(a.uploadedAt)
            : new Date(a.uploadedAt) - new Date(b.uploadedAt)
        }
        return 0
      })
    }

    res.json(files)
  } catch (error) {
    console.error(`[${req.requestId}] Error getting files:`, error)
    res.status(500).json({ error: "Failed to get files" })
  }
})

// Upload file
router.post(
  "/upload",
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" })
      }

      const fileService = new FileService(req.app.locals.supabase)
      const uploadOptions = JSON.parse(req.body.options || "{}")
      const fileRecord = await fileService.uploadFile(req.file, req.user.id, uploadOptions)

      // Clean up local file
      await fs.unlink(req.file.path)

      res.json({
        success: true,
        file: {
          id: fileRecord.id,
          name: fileRecord.original_name,
          size: fileRecord.size,
          encrypted: fileRecord.encrypted,
          createdAt: fileRecord.created_at
        }
      })
    } catch (error) {
      console.error(`[${req.requestId}] Upload error:`, error)
      res.status(500).json({ 
        error: error.message || "Failed to upload file",
        details: error.stack
      })
    }
  }
)

// Download file
router.get("/download/:fileId", async (req, res) => {
  try {
    const fileService = new FileService(req.app.locals.supabase)
    const { buffer, metadata } = await fileService.downloadFile(req.params.fileId, req.user.id)

    // Set response headers
    res.setHeader("Content-Type", metadata.type)
    res.setHeader("Content-Disposition", `attachment; filename="${metadata.name}"`)
    res.setHeader("Content-Length", metadata.size)
    res.setHeader("Cache-Control", "no-cache")
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition, Content-Type, Content-Length")

    // Send file
    res.send(buffer)
  } catch (error) {
    console.error(`[${req.requestId}] Download error:`, error)
    res.status(error.message.includes('not found') ? 404 : 500).json({ 
      error: error.message || "Failed to download file",
      details: error.stack
    })
  }
})

// Delete file
router.delete("/:fileId", async (req, res) => {
  try {
    const fileService = new FileService(req.app.locals.supabase)
    await fileService.deleteFile(req.params.fileId, req.user.id)
    res.json({
      success: true,
      message: "File deleted successfully"
    })
  } catch (error) {
    console.error(`[${req.requestId}] Delete error:`, error)
    res.status(500).json({ error: "Failed to delete file" })
  }
})

// Share file
router.post("/:fileId/share", async (req, res) => {
  try {
    const fileService = new FileService(req.app.locals.supabase)
    const accessControl = await fileService.shareFile(req.params.fileId, req.user.id, req.body)

    // Email notification logic
    if (
      req.body.notifyRecipient &&
      req.body.allowedUsers &&
      Array.isArray(req.body.allowedUsers) &&
      req.body.allowedUsers.length > 0
    ) {
      const recipientEmail = req.body.allowedUsers[0];
      const shareLink = `https://your-app.com/shared/${req.params.fileId}`; // Adjust as needed

      // Configure transporter
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: process.env.GMAIL_USER,        // Your Gmail address
          pass: process.env.GMAIL_APP_PASSWORD, // Your Gmail app password
        },
      });

      // Send the email
      await transporter.sendMail({
        from: '"Secure Vault" <' + process.env.GMAIL_USER + '>',
        to: recipientEmail,
        subject: "A file has been shared with you",
        text: `A file has been shared with you. Access it here: ${shareLink}`,
        html: `<p>A file has been shared with you.</p><p><a href="${shareLink}">Access the file</a></p>`,
      });
    }

    res.json({
      success: true,
      message: "File shared successfully",
      accessControl
    })
  } catch (error) {
    console.error(`[${req.requestId}] Share error:`, error)
    res.status(500).json({ error: "Failed to share file" })
  }
})

// Preview endpoint
router.get("/:id/preview", async (req, res) => {
  try {
    const fileId = req.params.id;
    const fileService = new FileService(req.app.locals.supabase);
    const { buffer, metadata } = await fileService.previewFile(fileId, req.user.id);

    // Set response headers
    res.setHeader("Content-Type", metadata.type);
    res.setHeader("Content-Disposition", `inline; filename="${metadata.name}"`);
    res.setHeader("Content-Length", metadata.size);
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Preview-Token", metadata.previewToken);

    // Send file for preview
    res.send(buffer);

    // Log audit
    await req.app.locals.supabase.from("audit_logs").insert({
      user_id: req.user.id,
      action: "file_preview",
      resource: `/files/${fileId}/preview`,
      ip_address: req.clientIP,
      user_agent: req.get("User-Agent"),
      success: true,
      details: {
        filename: metadata.name,
        type: metadata.type
      },
      created_at: new Date().toISOString()
    });

  } catch (error) {
    console.error(`[${req.requestId}] Preview error:`, error);
    res.status(500).json({ error: error.message || "Preview failed" });
  }
});

// Create new version of a file
router.post("/:fileId/versions", upload.single("file"), async (req, res) => {
  try {
    const { fileId } = req.params
    const { description } = req.body

    console.log(`[${req.requestId}] Create version request for file:`, fileId)

    // Get original file metadata and verify ownership
    const { data: originalFile, error: fileError } = await req.app.locals.supabase
      .from("files")
      .select("*")
      .eq("id", fileId)
      .eq("user_id", req.user.id)
      .eq("deleted", false)
      .single()

    if (fileError || !originalFile) {
      console.error(`[${req.requestId}] File not found or access denied:`, fileError)
      return res.status(404).json({ error: "File not found or access denied" })
    }

    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" })
    }

    // Calculate file hash
    const fileHash = await fileValidator.calculateHash(req.file.path)

    // Upload new version to Supabase Storage
    const fileBuffer = await fs.readFile(req.file.path)
    const fileExt = path.extname(req.file.originalname)
    const versionFileName = `${req.user.id}/${crypto.randomUUID()}${fileExt}`

    const { data: storageData, error: storageError } = await req.app.locals.supabase.storage
      .from("secure-files")
      .upload(versionFileName, fileBuffer, {
        contentType: req.file.mimetype,
        cacheControl: "3600"
      })

    if (storageError) {
      console.error(`[${req.requestId}] Storage error:`, storageError)
      throw storageError
    }

    // Get current version number
    const { data: versions } = await req.app.locals.supabase
      .from("file_versions")
      .select("version")
      .eq("file_id", fileId)
      .order("version", { ascending: false })
      .limit(1)

    const newVersion = versions && versions.length > 0 ? versions[0].version + 1 : 1

    // Create version record
    const { data: versionRecord, error: versionError } = await req.app.locals.supabase
      .from("file_versions")
      .insert({
        file_id: fileId,
        version: newVersion,
        stored_name: versionFileName,
        size: req.file.size,
        mime_type: req.file.mimetype,
        file_hash: fileHash,
        description: description || `Version ${newVersion}`,
        created_by: req.user.id,
        created_at: new Date().toISOString()
      })
      .select()
      .single()

    if (versionError) {
      console.error(`[${req.requestId}] Version creation error:`, versionError)
      throw versionError
    }

    // Update original file with new version info
    await req.app.locals.supabase
      .from("files")
      .update({
        current_version: newVersion,
        updated_at: new Date().toISOString()
      })
      .eq("id", fileId)

    // Log audit
    await req.app.locals.supabase.from("audit_logs").insert({
      user_id: req.user.id,
      action: "file_version_create",
      resource: `/files/${fileId}/versions/${newVersion}`,
      ip_address: req.clientIP,
      user_agent: req.get("User-Agent"),
      success: true,
      details: {
        filename: originalFile.original_name,
        version: newVersion,
        size: req.file.size
      },
      created_at: new Date().toISOString()
    })

    // Clean up local file
    await fs.unlink(req.file.path)

    res.json({
      success: true,
      message: "File version created successfully",
      version: {
        id: versionRecord.id,
        version: newVersion,
        size: req.file.size,
        description: versionRecord.description,
        createdAt: versionRecord.created_at
      }
    })

  } catch (error) {
    console.error(`[${req.requestId}] Version creation error:`, error)
    res.status(500).json({ error: "Failed to create file version" })
  }
})

// List file versions
router.get("/:fileId/versions", async (req, res) => {
  try {
    const { fileId } = req.params

    console.log(`[${req.requestId}] List versions request for file:`, fileId)

    // Get file metadata and verify access
    const { data: file, error: fileError } = await req.app.locals.supabase
      .from("files")
      .select("*")
      .eq("id", fileId)
      .eq("deleted", false)
      .single()

    if (fileError || !file) {
      console.error(`[${req.requestId}] File not found:`, fileError)
      return res.status(404).json({ error: "File not found" })
    }

    // Check if user has access
    if (file.user_id !== req.user.id && !file.shared) {
      console.error(`[${req.requestId}] Access denied for user:`, req.user.id)
      return res.status(403).json({ error: "Access denied" })
    }

    // Get all versions
    const { data: versions, error: versionsError } = await req.app.locals.supabase
      .from("file_versions")
      .select("*")
      .eq("file_id", fileId)
      .order("version", { ascending: false })

    if (versionsError) {
      console.error(`[${req.requestId}] Failed to fetch versions:`, versionsError)
      throw versionsError
    }

    // Log audit
    await req.app.locals.supabase.from("audit_logs").insert({
      user_id: req.user.id,
      action: "file_versions_list",
      resource: `/files/${fileId}/versions`,
      ip_address: req.clientIP,
      user_agent: req.get("User-Agent"),
      success: true,
      details: {
        filename: file.original_name,
        versionCount: versions.length
      },
      created_at: new Date().toISOString()
    })

    res.json({
      success: true,
      versions: versions.map(v => ({
        id: v.id,
        version: v.version,
        size: v.size,
        description: v.description,
        createdAt: v.created_at,
        createdBy: v.created_by
      }))
    })

  } catch (error) {
    console.error(`[${req.requestId}] List versions error:`, error)
    res.status(500).json({ error: "Failed to list file versions" })
  }
})

// Restore file version
router.post("/:fileId/versions/:versionId/restore", async (req, res) => {
  try {
    const { fileId, versionId } = req.params

    console.log(`[${req.requestId}] Restore version request for file:`, fileId)

    // Get file metadata and verify ownership
    const { data: file, error: fileError } = await req.app.locals.supabase
      .from("files")
      .select("*")
      .eq("id", fileId)
      .eq("user_id", req.user.id)
      .eq("deleted", false)
      .single()

    if (fileError || !file) {
      console.error(`[${req.requestId}] File not found or access denied:`, fileError)
      return res.status(404).json({ error: "File not found or access denied" })
    }

    // Get version metadata
    const { data: version, error: versionError } = await req.app.locals.supabase
      .from("file_versions")
      .select("*")
      .eq("id", versionId)
      .eq("file_id", fileId)
      .single()

    if (versionError || !version) {
      console.error(`[${req.requestId}] Version not found:`, versionError)
      return res.status(404).json({ error: "Version not found" })
    }

    // Create new version from the restored version
    const { data: newVersion, error: newVersionError } = await req.app.locals.supabase
      .from("file_versions")
      .insert({
        file_id: fileId,
        version: file.current_version + 1,
        stored_name: version.stored_name,
        size: version.size,
        mime_type: version.mime_type,
        file_hash: version.file_hash,
        description: `Restored from version ${version.version}`,
        created_by: req.user.id,
        created_at: new Date().toISOString()
      })
      .select()
      .single()

    if (newVersionError) {
      console.error(`[${req.requestId}] Version restoration error:`, newVersionError)
      throw newVersionError
    }

    // Update original file with new version info
    await req.app.locals.supabase
      .from("files")
      .update({
        current_version: newVersion.version,
        updated_at: new Date().toISOString()
      })
      .eq("id", fileId)

    // Log audit
    await req.app.locals.supabase.from("audit_logs").insert({
      user_id: req.user.id,
      action: "file_version_restore",
      resource: `/files/${fileId}/versions/${versionId}`,
      ip_address: req.clientIP,
      user_agent: req.get("User-Agent"),
      success: true,
      details: {
        filename: file.original_name,
        restoredVersion: version.version,
        newVersion: newVersion.version
      },
      created_at: new Date().toISOString()
    })

    res.json({
      success: true,
      message: "File version restored successfully",
      version: {
        id: newVersion.id,
        version: newVersion.version,
        size: newVersion.size,
        description: newVersion.description,
        createdAt: newVersion.created_at
      }
    })

  } catch (error) {
    console.error(`[${req.requestId}] Version restoration error:`, error)
    res.status(500).json({ error: "Failed to restore file version" })
  }
})

// Toggle favorite status for a file
router.post("/:id/favorite", async (req, res) => {
  try {
    const fileId = req.params.id;
    const userId = req.user.id;
    const { favorite } = req.body;

    // Update favorite status
    const { error } = await req.app.locals.supabase
      .from("files")
      .update({ favorite })
      .eq("id", fileId)
      .eq("user_id", userId);

    if (error) throw error;

    res.json({ success: true, favorite });
  } catch (error) {
    console.error("Failed to update favorite:", error);
    res.status(500).json({ error: "Failed to update favorite" });
  }
});

export default router
