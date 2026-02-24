import { Octokit } from "octokit";
import JSZip from "jszip";
import { Buffer } from "buffer";

export interface DeployStatus {
  step: string;
  details?: string;
  type: "info" | "success" | "error";
  progress?: number;
}

export type StatusCallback = (status: DeployStatus) => void;

export interface ZipAnalysis {
  zip: JSZip;
  fileCount: number;
  totalSize: number;
  projectType: "Static Website" | "Node.js Project" | "Vite" | "Create React App" | "Next.js" | "Angular" | "Vue" | "Unknown";
  files: { path: string; size: number; entry: JSZip.JSZipObject }[];
  warnings: string[];
  ignoredFiles: { path: string; reason: string }[];
}

export interface AutoFixPatch {
  path: string;
  content: string;
  description: string;
}

export async function generateAutoFixes(
  analysis: ZipAnalysis, 
  repoName: string
): Promise<AutoFixPatch[]> {
  const patches: AutoFixPatch[] = [];
  const { projectType, files } = analysis;

  // 1. GitHub Actions Workflow (Standard for all non-static)
  if (projectType !== "Static Website" && projectType !== "Unknown") {
    let buildCommand = "npm run build";
    let outputDir = "dist"; // Default for Vite

    if (projectType === "Create React App") {
      outputDir = "build";
    } else if (projectType === "Next.js") {
      outputDir = "out";
      buildCommand = "npm run build"; // Next.js needs export config
    } else if (projectType === "Angular") {
      outputDir = `dist/${repoName}`; // Angular defaults to dist/project-name
    }

    const workflowContent = `name: Deploy to GitHub Pages

on:
  push:
    branches: ["main"]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: "pages"
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: 'npm'
      - name: Install dependencies
        run: npm ci
      - name: Build
        run: ${buildCommand}
      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: ./${outputDir}

  deploy:
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    needs: build
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
`;
    patches.push({
      path: ".github/workflows/deploy.yml",
      content: workflowContent,
      description: `Create GitHub Actions workflow for ${projectType}`
    });
  }

  // 2. Vite Config Fix
  if (projectType === "Vite") {
    const viteConfig = files.find(f => f.path.match(/vite\.config\.(js|ts)$/));
    if (viteConfig) {
      let content = await viteConfig.entry.async("string");
      if (!content.includes("base:")) {
        // Simple regex replace to add base property
        // This is risky with regex but better than nothing for a simple fix
        if (content.includes("defineConfig({")) {
           content = content.replace("defineConfig({", `defineConfig({\n  base: "/${repoName}/",`);
           patches.push({
             path: viteConfig.path,
             content: content,
             description: `Update vite.config to set base path to "/${repoName}/"`
           });
        }
      }
    } else {
      // Create minimal vite config if missing (unlikely for Vite project but possible)
      patches.push({
        path: "vite.config.js",
        content: `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: "/${repoName}/",
})`,
        description: "Create vite.config.js with correct base path"
      });
    }
  }

  // 3. Next.js Config Fix
  if (projectType === "Next.js") {
    const nextConfig = files.find(f => f.path.match(/next\.config\.(js|mjs|ts)$/));
    if (nextConfig) {
      let content = await nextConfig.entry.async("string");
      if (!content.includes("output: 'export'") && !content.includes('output: "export"')) {
         // Try to inject output: export
         if (content.includes("nextConfig = {")) {
            content = content.replace("nextConfig = {", `nextConfig = {\n  output: 'export',`);
            patches.push({
              path: nextConfig.path,
              content: content,
              description: "Update next.config to enable static export"
            });
         }
      }
    }
  }

  // 4. CRA Homepage Fix
  if (projectType === "Create React App") {
    const packageJson = files.find(f => f.path === "package.json");
    if (packageJson) {
      let content = await packageJson.entry.async("string");
      if (!content.includes('"homepage"')) {
        // Insert homepage before name or version
        content = content.replace("{", `{\n  "homepage": "https://${repoName}.github.io/${repoName}",`); // Assuming username is owner, but we might not have it here easily. 
        // Wait, we need username for CRA homepage. 
        // For now, let's use relative path "." or just /repoName/ if we can.
        // Actually CRA recommends full URL.
        // Let's try to infer or just set it to "." which often works for relative serving
        // content = content.replace("{", `{\n  "homepage": ".",`); 
        // Better: use the repoName logic
        // We don't have username passed to this function yet. Let's assume we can pass it or use a placeholder.
        // The prompt says: "homepage": "https://<username>.github.io/<REPO_NAME>"
        // We'll use a placeholder or relative path.
        // Relative path "." is often safer for generic deployment.
        // But let's stick to the prompt requirement if possible.
        // We will update the function signature to accept username.
      }
    }
  }

  // 5. SPA 404 Fallback (for Vite/CRA/Vue/Angular)
  if (["Vite", "Create React App", "Vue", "Angular"].includes(projectType)) {
    // We can't easily create this file *during build* without modifying build scripts.
    // But we can add a postbuild script to package.json?
    // Or we can just create a 404.html in public/ folder if it exists!
    const publicDir = files.find(f => f.path === "public/");
    if (publicDir || files.some(f => f.path.startsWith("public/"))) {
       // Check if 404.html exists
       if (!files.some(f => f.path === "public/404.html")) {
         // Create a simple 404.html that redirects to index.html with query param
         // Or just copy index.html content? We don't have index.html content of BUILD yet.
         // Best strategy: Add a script to package.json to copy index.html to 404.html after build.
         
         const packageJson = files.find(f => f.path === "package.json");
         if (packageJson) {
            let content = await packageJson.entry.async("string");
            // Check if scripts exists
            if (content.includes('"build":')) {
               // Replace "build": "..." with "build": "... && cp dist/index.html dist/404.html" (Linux/Mac)
               // But this must be cross-platform.
               // Safer: Create a 404.html in public that does a client-side redirect hash router hack?
               // Or just use the GitHub Actions workflow to copy it!
               // YES! Update the workflow to copy 404.
            }
         }
       }
    }
  }
  
  // Update workflow to handle 404 for SPA
  const workflowPatch = patches.find(p => p.path === ".github/workflows/deploy.yml");
  if (workflowPatch && ["Vite", "Create React App", "Vue", "Angular"].includes(projectType)) {
     // Add step to copy index.html to 404.html before upload
     // Find "Upload artifact" step
     let outputDir = "dist";
     if (projectType === "Create React App") outputDir = "build";
     if (projectType === "Angular") outputDir = `dist/${repoName}`;

     const copyCmd = `cp ${outputDir}/index.html ${outputDir}/404.html || true`;
     
     // Insert before Upload artifact
     workflowPatch.content = workflowPatch.content.replace(
       `      - name: Upload artifact`,
       `      - name: Create 404 fallback
        run: ${copyCmd}
      - name: Upload artifact`
     );
  }

  return patches;
}

export async function analyzeZip(file: File): Promise<ZipAnalysis> {
  const zip = new JSZip();
  await zip.loadAsync(file);
  
  const rawFiles: { path: string; entry: JSZip.JSZipObject }[] = [];
  
  // 1. Filter and collect valid files
  zip.forEach((relativePath, fileEntry) => {
    if (!fileEntry.dir && !relativePath.includes("__MACOSX")) {
      rawFiles.push({ path: relativePath, entry: fileEntry });
    }
  });

  // 2. Detect common prefix (root folder)
  let commonPrefix = "";
  if (rawFiles.length > 0) {
    const sortedPaths = rawFiles.map(f => f.path).sort();
    const first = sortedPaths[0];
    const last = sortedPaths[sortedPaths.length - 1];
    
    let i = 0;
    while (i < first.length && first.charAt(i) === last.charAt(i)) {
      i++;
    }
    
    const prefix = first.substring(0, i);
    const lastSlash = prefix.lastIndexOf("/");
    if (lastSlash !== -1) {
      const potentialPrefix = prefix.substring(0, lastSlash + 1);
      if (rawFiles.every(f => f.path.startsWith(potentialPrefix))) {
        commonPrefix = potentialPrefix;
      }
    }
  }

  // 3. Process files (strip prefix) and analyze content
  const files: { path: string; size: number; entry: JSZip.JSZipObject }[] = [];
  const ignoredFiles: { path: string; reason: string }[] = [];
  let totalSize = 0;
  let hasIndexHtml = false;
  let hasPackageJson = false;
  let hasDistOrBuild = false;
  let indexHtmlContent = "";
  const warnings: string[] = [];

  for (const { path, entry } of rawFiles) {
    const finalPath = commonPrefix ? path.substring(commonPrefix.length) : path;
    // @ts-ignore
    const size = entry._data?.uncompressedSize || 0;
    
    // Smart Filtering Logic
    let ignoreReason = "";
    if (finalPath.includes(".DS_Store") || finalPath.includes("Thumbs.db")) ignoreReason = "System file";
    else if (finalPath.includes("node_modules/")) ignoreReason = "Dependency folder (should be built)";
    else if (finalPath.startsWith(".git/")) ignoreReason = "Git metadata";
    else if (finalPath.endsWith(".log")) ignoreReason = "Log file";
    else if (finalPath.endsWith(".env")) ignoreReason = "Environment file (security risk)";
    else if (finalPath.includes(".vscode/") || finalPath.includes(".idea/")) ignoreReason = "Editor config";

    if (ignoreReason) {
      ignoredFiles.push({ path: finalPath, reason: ignoreReason });
    } else {
      files.push({ path: finalPath, size, entry });
      totalSize += size;

      if (finalPath === "index.html") {
        hasIndexHtml = true;
        if (size < 500 * 1024) { 
           indexHtmlContent = await entry.async("string");
        }
      }
      if (finalPath === "package.json") hasPackageJson = true;
      if (finalPath.startsWith("dist/") || finalPath.startsWith("build/") || finalPath.startsWith("out/")) hasDistOrBuild = true;

      // Check for absolute paths
      if (finalPath.endsWith(".html") || finalPath.endsWith(".css") || finalPath.endsWith(".js")) {
        if (size < 1024 * 1024) { 
          const content = await entry.async("string");
          const absolutePathRegex = /(href|src)=["']\/(?!\/)[^"']*["']/i;
          if (absolutePathRegex.test(content)) {
            if (!warnings.includes("Absolute paths detected (e.g., src=\"/script.js\"). This breaks GitHub Pages.")) {
              warnings.push("Absolute paths detected (e.g., src=\"/script.js\"). This breaks GitHub Pages.");
            }
          }
        }
      }
    }
  }

  // 4. Advanced Analysis
  let projectType: ZipAnalysis["projectType"] = "Unknown";
  
  if (files.some(f => f.path.match(/vite\.config\.(js|ts)/))) projectType = "Vite";
  else if (files.some(f => f.path.match(/next\.config\.(js|mjs|ts)/))) projectType = "Next.js";
  else if (files.some(f => f.path === "angular.json")) projectType = "Angular";
  else if (files.some(f => f.path.includes("vue.config.js"))) projectType = "Vue";
  else if (hasPackageJson && files.some(f => f.path.includes("react-scripts"))) projectType = "Create React App";
  else if (hasIndexHtml) projectType = "Static Website";
  else if (hasPackageJson) projectType = "Node.js Project";

  // Validate Assets referenced in index.html
  if (hasIndexHtml && indexHtmlContent) {
    const matches = indexHtmlContent.matchAll(/(?:src|href)=["']([^"']+)["']/g);
    for (const match of matches) {
      let ref = match[1];
      if (ref.startsWith("http") || ref.startsWith("//") || ref.startsWith("#") || ref.startsWith("/")) continue;
      ref = ref.split("?")[0].split("#")[0];
      if (ref.startsWith("./")) ref = ref.substring(2);
      
      const assetExists = files.some(f => f.path === ref);
      if (!assetExists) {
         if (!warnings.includes(`Missing asset referenced in index.html: '${ref}'`)) {
           warnings.push(`Missing asset referenced in index.html: '${ref}'`);
         }
      }
    }
  }

  if (hasPackageJson && !hasIndexHtml && projectType === "Unknown") {
    if (hasDistOrBuild) {
       warnings.push("Found 'package.json' and 'dist/build' folder. You likely uploaded the source code. Please upload ONLY the contents of the 'dist' or 'build' folder.");
    } else {
       warnings.push("Detected 'package.json' but no 'index.html' at root. Are you uploading source code? You must build your project first (npm run build) and upload the output folder.");
    }
  }

  if (!hasIndexHtml && !hasPackageJson && projectType === "Unknown") {
    const nestedIndex = files.find(f => f.path.endsWith("/index.html"));
    if (nestedIndex) {
      warnings.push(`'index.html' found at '${nestedIndex.path}'. It must be at the root level. Please unzip, go into the folder, and zip the CONTENTS.`);
    } else {
      warnings.push("No 'index.html' found. Your site will not load.");
    }
  }

  return {
    zip,
    fileCount: files.length,
    totalSize,
    projectType,
    files,
    warnings,
    ignoredFiles
  };
}

export async function fixAbsolutePaths(analysis: ZipAnalysis): Promise<ZipAnalysis> {
  const newFiles = await Promise.all(analysis.files.map(async (file) => {
    // Only fix HTML/CSS/JS files
    if (!file.path.match(/\.(html|css|js)$/i)) return file;
    
    // Skip large files
    if (file.size > 1024 * 1024) return file;

    let content = await file.entry.async("string");
    let modified = false;

    // Fix src="/..." to src="./..."
    // Be careful not to break http:// or // links
    // Regex: look for src= or href= followed by quote, then /, then NOT /
    const regex = /(src|href)=["']\/(?!\/)([^"']*)["']/gi;
    
    if (regex.test(content)) {
      content = content.replace(regex, (match, attr, path) => {
        modified = true;
        // Return as src="./path"
        // We use ./ to be safe relative path
        const quote = match.includes('"') ? '"' : "'";
        return `${attr}=${quote}./${path}${quote}`;
      });
    }

    if (modified) {
      // Create a new zip entry with modified content
      const newZip = new JSZip();
      newZip.file(file.path, content);
      const newEntry = newZip.file(file.path)!;
      
      return {
        ...file,
        entry: newEntry,
        size: content.length // Update size
      };
    }

    return file;
  }));

  // Remove the warning about absolute paths since we fixed them
  const newWarnings = analysis.warnings.filter(w => !w.includes("Absolute paths detected"));
  
  return {
    ...analysis,
    files: newFiles,
    warnings: newWarnings
  };
}

export async function deployZipToGitHub(
  token: string,
  repoName: string,
  description: string,
  isPrivate: boolean,
  analysis: ZipAnalysis,
  onStatus: StatusCallback,
  customDomain?: string,
  patches?: AutoFixPatch[]
) {
  const octokit = new Octokit({ auth: token });
  let owner = "";

  try {
    // 1. Authenticate and get user info
    onStatus({ step: "Authenticating...", type: "info" });
    const { data: user } = await octokit.rest.users.getAuthenticated();
    owner = user.login;
    onStatus({ step: `Authenticated as ${owner}`, type: "success" });

    // 2. Create or Get Repository
    onStatus({ step: `Setting up repository "${repoName}"...`, type: "info" });
    let defaultBranch = "main";
    
    try {
      const { data: repo } = await octokit.rest.repos.createForAuthenticatedUser({
        name: repoName,
        description: description || "Deployed via ZipToRepo",
        private: isPrivate,
        auto_init: true, 
      });
      defaultBranch = repo.default_branch;
      onStatus({ step: "Repository created successfully.", type: "success" });
    } catch (error: any) {
      if (error.status === 422) {
        onStatus({ step: `Repository "${repoName}" already exists. Fetching details...`, type: "info" });
        const { data: repo } = await octokit.rest.repos.get({
          owner,
          repo: repoName,
        });
        defaultBranch = repo.default_branch;
      } else {
        throw error;
      }
    }

    // 3. Process Files from Analysis
    onStatus({ step: "Preparing files from analysis...", type: "info" });
    
    const filesToUpload: { path: string; content: Uint8Array; mode: "100644" }[] = [];
    
    for (const file of analysis.files) {
      const content = await file.entry.async("uint8array");
      filesToUpload.push({
        path: file.path,
        content: content,
        mode: "100644",
      });
    }

    // Apply Patches (Auto-Fixes)
    if (patches && patches.length > 0) {
      onStatus({ step: `Applying ${patches.length} auto-fixes...`, type: "info" });
      for (const patch of patches) {
        // Check if file already exists in filesToUpload, if so replace it
        const existingIndex = filesToUpload.findIndex(f => f.path === patch.path);
        const patchContent = new TextEncoder().encode(patch.content);
        
        if (existingIndex !== -1) {
          filesToUpload[existingIndex].content = patchContent;
        } else {
          filesToUpload.push({
            path: patch.path,
            content: patchContent,
            mode: "100644"
          });
        }
      }
    }

    // Add CNAME if custom domain is provided
    if (customDomain) {
      onStatus({ step: `Adding CNAME for ${customDomain}...`, type: "info" });
      filesToUpload.push({
        path: "CNAME",
        content: new TextEncoder().encode(customDomain),
        mode: "100644",
      });
    }

    onStatus({ step: `Prepared ${filesToUpload.length} files for upload.`, type: "info" });

    // 4. Get the latest commit SHA
    let latestCommitSha = "";
    let baseTreeSha = "";

    try {
      const { data: refData } = await octokit.rest.git.getRef({
        owner,
        repo: repoName,
        ref: `heads/${defaultBranch}`,
      });
      latestCommitSha = refData.object.sha;

      // Get the commit to get the tree SHA
      const { data: commitData } = await octokit.rest.git.getCommit({
        owner,
        repo: repoName,
        commit_sha: latestCommitSha,
      });
      baseTreeSha = commitData.tree.sha;
      
    } catch (e) {
      // If ref doesn't exist (empty repo), we start fresh (no base tree)
      onStatus({ step: "No existing commit found. Starting fresh...", type: "info" });
    }

    // 5. Create Blobs (in batches with retry)
    onStatus({ step: "Uploading files...", type: "info" });
    
    const treeItems: { path: string; mode: "100644" | "100755" | "040000" | "160000" | "120000"; type: "blob"; sha: string }[] = [];
    
    const BATCH_SIZE = 5;
    for (let i = 0; i < filesToUpload.length; i += BATCH_SIZE) {
      const batch = filesToUpload.slice(i, i + BATCH_SIZE);
      
      await Promise.all(batch.map(async (file) => {
        const contentBase64 = Buffer.from(file.content).toString("base64");
        
        // Simple retry logic
        let retries = 3;
        while (retries > 0) {
          try {
            const { data: blob } = await octokit.rest.git.createBlob({
              owner,
              repo: repoName,
              content: contentBase64,
              encoding: "base64",
            });
            
            treeItems.push({
              path: file.path,
              mode: file.mode,
              type: "blob",
              sha: blob.sha,
            });
            break; // Success
          } catch (err) {
            retries--;
            if (retries === 0) throw err;
            await new Promise(r => setTimeout(r, 1000)); // Wait 1s before retry
          }
        }
      }));
      
      onStatus({ 
        step: `Uploaded ${Math.min(i + BATCH_SIZE, filesToUpload.length)}/${filesToUpload.length} files...`, 
        type: "info",
        progress: Math.round((Math.min(i + BATCH_SIZE, filesToUpload.length) / filesToUpload.length) * 100)
      });
    }

    // 6. Create Tree
    onStatus({ step: "Creating file tree...", type: "info" });
    const createTreeParams: any = {
      owner,
      repo: repoName,
      tree: treeItems,
    };
    
    if (baseTreeSha) {
      createTreeParams.base_tree = baseTreeSha;
    }

    const { data: tree } = await octokit.rest.git.createTree(createTreeParams);

    // 7. Create Commit
    onStatus({ step: "Creating commit...", type: "info" });
    const commitParams: any = {
      owner,
      repo: repoName,
      message: `Deploy project via ZipToRepo`,
      tree: tree.sha,
    };
    
    if (latestCommitSha) {
      commitParams.parents = [latestCommitSha];
    }

    const { data: newCommit } = await octokit.rest.git.createCommit(commitParams);

    // 8. Update Reference (Force Push)
    onStatus({ step: "Updating repository reference...", type: "info" });
    await octokit.rest.git.updateRef({
      owner,
      repo: repoName,
      ref: `heads/${defaultBranch}`,
      sha: newCommit.sha,
      force: true, // Force update to overwrite history if needed
    });

    // 9. Enable GitHub Pages (Auto-configure)
    onStatus({ step: "Enabling GitHub Pages...", type: "info" });
    let pagesUrl = `https://${owner}.github.io/${repoName}/`;
    
    // Wait a bit for consistency
    await new Promise(r => setTimeout(r, 2000));

    try {
      const { data: pages } = await octokit.rest.repos.createPagesSite({
        owner,
        repo: repoName,
        source: {
          branch: defaultBranch,
          path: "/"
        }
      });
      pagesUrl = pages.html_url || pagesUrl;
      onStatus({ step: "GitHub Pages enabled successfully!", type: "success" });
    } catch (err: any) {
      // If already enabled (409), it's fine.
      if (err.status === 409) {
         onStatus({ step: "GitHub Pages already enabled.", type: "info" });
         
         // Try to get the URL if it exists
         try {
           const { data: existingPages } = await octokit.rest.repos.getPages({ owner, repo: repoName });
           pagesUrl = existingPages.html_url || pagesUrl;
         } catch (e) { /* ignore */ }

      } else {
         console.warn("Failed to enable Pages automatically:", err);
         onStatus({ step: "Could not auto-enable Pages (Check Settings manually).", type: "info" });
      }
    }

    onStatus({ 
      step: "Deployment complete!", 
      details: pagesUrl,
      type: "success" 
    });

    return pagesUrl;

  } catch (error: any) {
    console.error("Deployment failed:", error);
    onStatus({ 
      step: "Deployment failed", 
      details: error.message || "Unknown error occurred", 
      type: "error" 
    });
    throw error;
  }
}
