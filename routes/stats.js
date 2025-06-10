const express = require("express")

const router = express.Router()

// Import the uploaded files from the files route (in production, use database)
// For now, we'll access the uploadedFiles array through a simple require
const uploadedFiles = []

// Function to get uploaded files (this would be a database query in production)
const getUploadedFiles = () => {
  // In a real app, this would be a database query
  // For now, we'll try to access the files from the files route
  try {
    // This is a hack for development - in production use a proper database
    const filesRoute = require("./files")
    return filesRoute.uploadedFiles || []
  } catch (error) {
    return []
  }
}

router.get("/", async (req, res) => {
  try {
    const userId = req.user.id
    console.log(`[${req.requestId}] Getting stats for user:`, userId)

    // Get user's files (in production, this would be a database query)
    const userFiles = uploadedFiles.filter((file) => file.userId === userId)

    console.log(`[${req.requestId}] Found ${userFiles.length} files for stats`)

    // Calculate total size
    const totalSize = userFiles.reduce((sum, file) => sum + (file.size || 0), 0)

    // Find last upload
    const lastUpload =
      userFiles.length > 0 ? new Date(Math.max(...userFiles.map((f) => new Date(f.uploadedAt).getTime()))) : null

    // Count shared files
    const activeShares = userFiles.filter((file) => file.shared).length

    // Calculate security score
    let securityScore = 50 // Base score
    if (userFiles.some((f) => f.encrypted)) securityScore += 30
    if (userFiles.length > 0) securityScore += 20

    const stats = {
      totalFiles: userFiles.length,
      totalSize,
      lastUpload: lastUpload ? lastUpload.toLocaleDateString() : "Never",
      activeShares,
      securityScore: Math.min(securityScore, 100),
    }

    console.log(`[${req.requestId}] Stats calculated:`, stats)

    res.json({ data: stats })
  } catch (error) {
    console.error(`[${req.requestId}] Stats error:`, error)
    res.status(500).json({ error: "Failed to fetch statistics" })
  }
})

module.exports = router
