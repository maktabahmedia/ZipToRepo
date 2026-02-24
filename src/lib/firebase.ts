import { ZipAnalysis, DeployStatus, StatusCallback } from "./github";

const FIREBASE_API_BASE = "https://firebasehosting.googleapis.com/v1beta1";

async function calculateSHA256(content: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", content);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function deployZipToFirebase(
  token: string,
  siteId: string,
  analysis: ZipAnalysis,
  onStatus: StatusCallback
) {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  try {
    // 1. Verify Site/Project exists (optional, but good for validation)
    // We'll skip explicit verification and let the version creation fail if invalid to save a request,
    // or we could try to get the site details.
    
    // 2. Create a new Version
    onStatus({ step: "Creating new version...", type: "info" });
    const versionRes = await fetch(`${FIREBASE_API_BASE}/sites/${siteId}/versions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        config: {
          headers: [{ glob: "**", headers: { "Cache-Control": "max-age=1800" } }],
        },
      }),
    });

    if (!versionRes.ok) {
      const err = await versionRes.json();
      throw new Error(`Failed to create version: ${err.error?.message || versionRes.statusText}`);
    }

    const versionData = await versionRes.json();
    const versionName = versionData.name; // sites/{siteId}/versions/{versionId}
    onStatus({ step: `Version created: ${versionName.split("/").pop()}`, type: "success" });

    // 3. Calculate Hashes
    onStatus({ step: "Calculating file hashes...", type: "info" });
    const filesByPath: Record<string, string> = {}; // path -> hash
    const contentByHash: Record<string, Uint8Array> = {}; // hash -> content

    for (const file of analysis.files) {
      // Firebase expects paths to start with / usually, or just relative. 
      // The API documentation says "The path to the file, relative to the root of the site."
      // It should NOT start with a slash.
      let cleanPath = file.path;
      if (cleanPath.startsWith("/")) cleanPath = cleanPath.substring(1);

      const content = await file.entry.async("uint8array");
      const hash = await calculateSHA256(content);
      
      filesByPath[cleanPath] = hash;
      contentByHash[hash] = content;
    }

    // 4. Populate Files
    onStatus({ step: "Registering files...", type: "info" });
    const populateRes = await fetch(`${FIREBASE_API_BASE}/${versionName}:populateFiles`, {
      method: "POST",
      headers,
      body: JSON.stringify({ files: filesByPath }),
    });

    if (!populateRes.ok) {
      const err = await populateRes.json();
      throw new Error(`Failed to populate files: ${err.error?.message || populateRes.statusText}`);
    }

    const populateData = await populateRes.json();
    const uploadUrlMap = populateData.uploadUrlMap || {};
    const requiredHashes = populateData.uploadRequiredHashes || [];

    // 5. Upload Required Files
    if (requiredHashes.length > 0) {
      onStatus({ step: `Uploading ${requiredHashes.length} new files...`, type: "info" });
      
      // Upload in batches
      const BATCH_SIZE = 5;
      for (let i = 0; i < requiredHashes.length; i += BATCH_SIZE) {
        const batch = requiredHashes.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (hash: string) => {
          const content = contentByHash[hash];
          const uploadUrl = uploadUrlMap[hash];
          
          const uploadRes = await fetch(uploadUrl, {
            method: "POST",
            body: content, // Raw bytes
            headers: {
              "Content-Type": "application/octet-stream",
            },
          });

          if (!uploadRes.ok) {
            throw new Error(`Failed to upload file with hash ${hash}`);
          }
        }));
        
        onStatus({ 
          step: `Uploaded ${Math.min(i + BATCH_SIZE, requiredHashes.length)}/${requiredHashes.length} files...`, 
          type: "info",
          progress: Math.round((Math.min(i + BATCH_SIZE, requiredHashes.length) / requiredHashes.length) * 100)
        });
      }
    } else {
      onStatus({ step: "All files already exist on Firebase.", type: "info" });
    }

    // 6. Finalize Version
    onStatus({ step: "Finalizing version...", type: "info" });
    const finalizeRes = await fetch(`${FIREBASE_API_BASE}/${versionName}?update_mask=status`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ status: "FINALIZED" }),
    });

    if (!finalizeRes.ok) {
      const err = await finalizeRes.json();
      throw new Error(`Failed to finalize version: ${err.error?.message || finalizeRes.statusText}`);
    }

    // 7. Release
    onStatus({ step: "Releasing to live...", type: "info" });
    const releaseRes = await fetch(`${FIREBASE_API_BASE}/sites/${siteId}/releases`, {
      method: "POST",
      headers,
      body: JSON.stringify({ versionName }), // Query param versionName is deprecated, use body
    });

    if (!releaseRes.ok) {
      const err = await releaseRes.json();
      throw new Error(`Failed to release: ${err.error?.message || releaseRes.statusText}`);
    }

    const defaultUrl = `https://${siteId}.web.app`;
    onStatus({ 
      step: "Deployment complete!", 
      details: defaultUrl,
      type: "success" 
    });

    return defaultUrl;

  } catch (error: any) {
    console.error("Firebase Deployment failed:", error);
    onStatus({ 
      step: "Deployment failed", 
      details: error.message || "Unknown error occurred", 
      type: "error" 
    });
    throw error;
  }
}
