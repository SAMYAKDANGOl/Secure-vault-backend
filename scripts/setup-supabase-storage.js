const { createClient } = require("@supabase/supabase-js")
require("dotenv").config()

async function setupSupabaseStorage() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing Supabase credentials. Please check your .env file.")
    process.exit(1)
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  console.log("Connected to Supabase")

  try {
    // Check if bucket exists
    const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets()

    if (bucketsError) {
      console.error("Error listing buckets:", bucketsError)
      process.exit(1)
    }

    const bucketName = "secure-files"
    const bucketExists = buckets.some((bucket) => bucket.name === bucketName)

    if (!bucketExists) {
      console.log(`Creating bucket: ${bucketName}`)
      const { data, error } = await supabase.storage.createBucket(bucketName, {
        public: false,
        fileSizeLimit: 104857600, // 100MB
        allowedMimeTypes: [
          "image/*",
          "video/*",
          "audio/*",
          "application/pdf",
          "application/msword",
          "application/vnd.openxmlformats-officedocument.*",
          "text/*",
          "application/zip",
          "application/x-rar-compressed",
        ],
      })

      if (error) {
        console.error("Error creating bucket:", error)
        process.exit(1)
      }

      console.log("Bucket created successfully")
    } else {
      console.log(`Bucket '${bucketName}' already exists`)
    }

    // Set up RLS policies for the bucket
    console.log("Setting up RLS policies for storage...")

    // This is a simplified example - in production you would use the Supabase dashboard
    // or the Management API to set up proper RLS policies
    console.log("Please set up the following RLS policies in your Supabase dashboard:")
    console.log(`
    -- Allow users to read their own files
    CREATE POLICY "Users can read own files" 
    ON storage.objects FOR SELECT 
    USING (auth.uid()::text = (storage.foldername(name))[1]);
    
    -- Allow users to upload their own files
    CREATE POLICY "Users can upload own files" 
    ON storage.objects FOR INSERT 
    WITH CHECK (auth.uid()::text = (storage.foldername(name))[1]);
    
    -- Allow users to update their own files
    CREATE POLICY "Users can update own files" 
    ON storage.objects FOR UPDATE 
    USING (auth.uid()::text = (storage.foldername(name))[1]);
    
    -- Allow users to delete their own files
    CREATE POLICY "Users can delete own files" 
    ON storage.objects FOR DELETE 
    USING (auth.uid()::text = (storage.foldername(name))[1]);
    `)

    console.log("Supabase storage setup complete!")
  } catch (error) {
    console.error("Unexpected error:", error)
    process.exit(1)
  }
}

setupSupabaseStorage()
