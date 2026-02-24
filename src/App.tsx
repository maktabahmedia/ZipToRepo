import React, { useState, useCallback, useEffect } from "react";
import { useDropzone, type DropzoneOptions } from "react-dropzone";
import { motion, AnimatePresence } from "motion/react";
import JSZip from "jszip";
import confetti from "canvas-confetti";
import { 
  Github, 
  Upload, 
  CheckCircle, 
  AlertCircle, 
  Loader2, 
  ArrowRight, 
  FolderGit2, 
  FileArchive,
  FileCode,
  Box,
  Flame,
  Globe,
  FolderInput,
  History,
  Copy,
  Check,
  ChevronRight,
  ChevronDown,
  Folder,
  File as FileIcon,
  X,
  Eye,
  AlertTriangle,
  Trash2,
  Hammer,
  CheckCircle2,
  Wand2,
  Terminal,
  Settings2
} from "lucide-react";
import { deployZipToGitHub, analyzeZip, fixAbsolutePaths, generateAutoFixes, type DeployStatus, type ZipAnalysis, type AutoFixPatch } from "./lib/github";
import { deployZipToFirebase } from "./lib/firebase";
import { cn } from "./lib/utils";

// --- Types ---

interface DeploymentRecord {
  id: string;
  provider: "github" | "firebase";
  name: string; // repo name or site id
  url: string;
  date: string;
}

interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  size?: number;
  children?: TreeNode[];
}

// --- Helper Functions ---

function buildTree(files: { path: string; size: number }[]): TreeNode[] {
  const root: TreeNode[] = [];
  
  files.forEach(file => {
    // Remove leading slash if present
    const cleanPath = file.path.startsWith('/') ? file.path.slice(1) : file.path;
    const parts = cleanPath.split('/');
    let currentLevel = root;
    
    parts.forEach((part, index) => {
      const isFile = index === parts.length - 1;
      const existingNode = currentLevel.find(node => node.name === part);
      
      if (existingNode) {
        if (!isFile && existingNode.children) {
           currentLevel = existingNode.children;
        }
      } else {
        const newNode: TreeNode = {
          name: part,
          path: parts.slice(0, index + 1).join('/'),
          type: isFile ? 'file' : 'folder',
          size: isFile ? file.size : undefined,
          children: isFile ? undefined : []
        };
        currentLevel.push(newNode);
        if (!isFile && newNode.children) {
          currentLevel = newNode.children;
        }
      }
    });
  });
  
  return root;
}

// --- Components ---

const FileTreeNode: React.FC<{ node: TreeNode; level?: number }> = ({ node, level = 0 }) => {
  const [isOpen, setIsOpen] = useState(level < 1); // Open root level by default

  if (node.type === 'file') {
    return (
      <div 
        className="flex items-center gap-2 py-1 text-xs text-gray-600 hover:bg-gray-50 rounded px-2"
        style={{ paddingLeft: `${level * 12 + 8}px` }}
      >
        <FileIcon className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
        <span className="truncate">{node.name}</span>
        <span className="text-gray-400 ml-auto">{(node.size! / 1024).toFixed(1)} KB</span>
      </div>
    );
  }

  return (
    <div>
      <div 
        className="flex items-center gap-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 rounded px-2 cursor-pointer select-none"
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={() => setIsOpen(!isOpen)}
      >
        {isOpen ? (
          <ChevronDown className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
        )}
        <Folder className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
        <span className="truncate">{node.name}</span>
      </div>
      {isOpen && node.children && (
        <div>
          {node.children
            .sort((a, b) => {
              if (a.type === b.type) return a.name.localeCompare(b.name);
              return a.type === 'folder' ? -1 : 1;
            })
            .map((child) => (
            <FileTreeNode key={child.path} node={child} level={level + 1} />
          ))}
        </div>
      )}
    </div>
  );
};

const HistoryModal = ({ 
  isOpen, 
  onClose, 
  history 
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  history: DeploymentRecord[] 
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col"
      >
        <div className="p-4 border-b border-gray-100 flex justify-between items-center">
          <h3 className="font-semibold text-lg flex items-center gap-2">
            <History className="w-5 h-5" /> Deployment History
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-full">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>
        
        <div className="overflow-y-auto p-4 space-y-3 flex-1">
          {history.length === 0 ? (
            <div className="text-center text-gray-500 py-8">
              <p>No deployments yet.</p>
            </div>
          ) : (
            history.map((record) => (
              <div key={record.id} className="border border-gray-100 rounded-xl p-3 hover:shadow-sm transition-shadow">
                <div className="flex justify-between items-start mb-1">
                  <div className="flex items-center gap-2">
                    {record.provider === 'firebase' ? (
                      <Flame className="w-4 h-4 text-orange-500" />
                    ) : (
                      <Github className="w-4 h-4 text-black" />
                    )}
                    <span className="font-medium text-sm">{record.name}</span>
                  </div>
                  <span className="text-[10px] text-gray-400">
                    {new Date(record.date).toLocaleDateString()}
                  </span>
                </div>
                <a 
                  href={record.url} 
                  target="_blank" 
                  rel="noreferrer" 
                  className="text-xs text-blue-600 hover:underline truncate block"
                >
                  {record.url}
                </a>
              </div>
            ))
          )}
        </div>
      </motion.div>
    </div>
  );
};

const PreviewModal = ({ 
  isOpen, 
  onClose, 
  analysis 
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  analysis: ZipAnalysis | null 
}) => {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && analysis) {
      const loadPreview = async () => {
        // Find index.html
        const indexFile = analysis.files.find(f => f.path === "index.html");
        if (!indexFile) return;

        // Create a blob map for all files to handle relative links
        const fileMap: Record<string, string> = {};
        
        // We need to process all files to make them accessible
        // This is a simplified previewer. For complex sites, it might be limited.
        for (const file of analysis.files) {
           // Only process text/image files for preview to save memory
           if (file.path.match(/\.(html|css|js|png|jpg|jpeg|svg|gif)$/i)) {
             const blob = await file.entry.async("blob");
             // Determine mime type
             let mime = "text/plain";
             if (file.path.endsWith(".html")) mime = "text/html";
             else if (file.path.endsWith(".css")) mime = "text/css";
             else if (file.path.endsWith(".js")) mime = "application/javascript";
             else if (file.path.endsWith(".png")) mime = "image/png";
             else if (file.path.endsWith(".jpg")) mime = "image/jpeg";
             else if (file.path.endsWith(".svg")) mime = "image/svg+xml";
             
             // We can't easily rewrite all URLs in blobs without a service worker.
             // So this preview is best effort for single file or simple relative paths.
             // A better approach for a real "Preview" is creating a Blob URL for index.html
             // and injecting a <base> tag or rewriting links.
             
             // Let's try a simple approach: Just load index.html content and replace relative links 
             // with object URLs is too complex for client-side without SW.
             // FALLBACK: Just show index.html and warn about broken assets if any.
             
             // Actually, for a "Smart" app, let's just render the HTML string in an iframe
             // and maybe try to inline CSS/JS if possible? Too heavy.
             
             // Alternative: "Simulated" Preview.
             // We will just display the raw HTML of index.html in a sandboxed iframe.
             // It won't load external assets (css/js) unless they are CDN links.
             // But it proves index.html exists and is readable.
           }
        }
        
        const content = await indexFile.entry.async("string");
        const blob = new Blob([content], { type: "text/html" });
        setPreviewUrl(URL.createObjectURL(blob));
      };
      
      loadPreview();
    } else {
      setPreviewUrl(null);
    }
  }, [isOpen, analysis]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-2xl shadow-xl w-full max-w-4xl h-[80vh] flex flex-col"
      >
        <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50 rounded-t-2xl">
          <h3 className="font-semibold text-lg flex items-center gap-2">
            <Eye className="w-5 h-5" /> Local Preview (Index Only)
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-200 rounded-full">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>
        
        <div className="flex-1 bg-white relative">
          {previewUrl ? (
            <iframe 
              src={previewUrl} 
              className="w-full h-full border-none" 
              title="Preview"
              sandbox="allow-scripts" // Allow scripts but no same-origin (safer)
            />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-400">
              Loading preview or no index.html found...
            </div>
          )}
          <div className="absolute bottom-0 left-0 right-0 bg-yellow-50 p-2 text-xs text-yellow-700 text-center border-t border-yellow-100">
            Note: This is a basic preview of your index.html. Linked local assets (CSS/Images) may not load here but will work after deployment if paths are correct.
          </div>
        </div>
      </motion.div>
    </div>
  );
};

const CopyButton = ({ text }: { text: string }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button 
      onClick={handleCopy}
      className="p-2 text-gray-500 hover:text-black hover:bg-gray-100 rounded-lg transition-all"
      title="Copy URL"
    >
      {copied ? <Check className="w-5 h-5 text-green-600" /> : <Copy className="w-5 h-5" />}
    </button>
  );
};

const ProgressBar = ({ progress }: { progress: number }) => (
  <div className="w-full bg-gray-200 rounded-full h-2.5 mt-2">
    <div 
      className="bg-blue-600 h-2.5 rounded-full transition-all duration-300" 
      style={{ width: `${progress}%` }}
    ></div>
  </div>
);

const StepIndicator = ({ currentStep, provider }: { currentStep: number, provider: "github" | "firebase" | null }) => {
  const steps = [
    { id: 0, label: "Provider" },
    { id: 1, label: "Token" },
    { id: 2, label: provider === "firebase" ? "Site ID" : "Repo" },
    { id: 3, label: "Upload" },
    { id: 4, label: "Deploy" },
  ];

  return (
    <div className="flex items-center justify-center mb-8 w-full max-w-xl mx-auto px-4">
      {steps.map((step, index) => (
        <div key={step.id} className="flex items-center">
          <div className="relative flex flex-col items-center">
            <div
              className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors duration-300 z-10",
                currentStep >= step.id
                  ? "bg-black text-white"
                  : "bg-gray-200 text-gray-500"
              )}
            >
              {currentStep > step.id ? <CheckCircle className="w-5 h-5" /> : step.id + 1}
            </div>
            <span className="absolute -bottom-6 text-xs font-medium text-gray-500 whitespace-nowrap">
              {step.label}
            </span>
          </div>
          {index < steps.length - 1 && (
            <div
              className={cn(
                "w-8 sm:w-16 h-0.5 mx-1 sm:mx-2 transition-colors duration-300",
                currentStep > step.id ? "bg-black" : "bg-gray-200"
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
};

const Card = ({ children, className }: { children: React.ReactNode; className?: string; key?: React.Key }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -20 }}
    className={cn("bg-white rounded-2xl shadow-sm border border-gray-100 p-8 w-full max-w-md mx-auto", className)}
  >
    {children}
  </motion.div>
);

const Button = ({ 
  children, 
  onClick, 
  disabled, 
  variant = "primary", 
  className 
}: { 
  children: React.ReactNode; 
  onClick?: () => void; 
  disabled?: boolean; 
  variant?: "primary" | "secondary"; 
  className?: string;
}) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={cn(
      "w-full py-3 px-4 rounded-xl font-medium transition-all duration-200 flex items-center justify-center gap-2",
      variant === "primary" 
        ? "bg-black text-white hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed"
        : "bg-gray-100 text-gray-900 hover:bg-gray-200",
      className
    )}
  >
    {children}
  </button>
);

const Input = ({ 
  label, 
  value, 
  onChange, 
  placeholder, 
  type = "text",
  helperText
}: { 
  label: string; 
  value: string; 
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; 
  placeholder?: string; 
  type?: string;
  helperText?: React.ReactNode;
}) => (
  <div className="mb-4">
    <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:border-black focus:ring-1 focus:ring-black outline-none transition-all"
    />
    {helperText && <div className="mt-1.5 text-xs text-gray-500">{helperText}</div>}
  </div>
);

// --- Main App ---

export default function App() {
  const [step, setStep] = useState(0);
  const [provider, setProvider] = useState<"github" | "firebase" | null>(null);
  const [token, setToken] = useState("");
  const [rememberToken, setRememberToken] = useState(false);
  const [repoName, setRepoName] = useState(""); // Also used for Site ID in Firebase
  const [description, setDescription] = useState("");
  const [customDomain, setCustomDomain] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<ZipAnalysis | null>(null);
  const [patches, setPatches] = useState<AutoFixPatch[]>([]);
  const [logs, setLogs] = useState<DeployStatus[]>([]);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployedUrl, setDeployedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const logsEndRef = React.useRef<HTMLDivElement>(null);

  // Scroll to bottom of logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);
  
  // History State
  const [history, setHistory] = useState<DeploymentRecord[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // Load History
  useEffect(() => {
    const savedHistory = localStorage.getItem("deployHistory");
    if (savedHistory) {
      try {
        setHistory(JSON.parse(savedHistory));
      } catch (e) {
        console.error("Failed to parse history", e);
      }
    }
  }, []);

  const handleGithubLogin = async () => {
    try {
      const response = await fetch("/api/auth/github/url");
      if (!response.ok) throw new Error("Failed to get auth URL");
      const { url } = await response.json();

      const width = 600;
      const height = 700;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;
      
      const popup = window.open(
        url,
        "github_oauth",
        `width=${width},height=${height},top=${top},left=${left}`
      );

      if (!popup) {
        alert("Please allow popups to login with GitHub");
        return;
      }

      const handleMessage = (event: MessageEvent) => {
        if (event.data?.type === "GITHUB_AUTH_SUCCESS" && event.data.token) {
          setToken(event.data.token);
          setStep(2); 
          window.removeEventListener("message", handleMessage);
        }
      };

      window.addEventListener("message", handleMessage);
    } catch (err) {
      console.error("Login failed:", err);
      setError("Failed to initiate GitHub login");
    }
  };

  const handleGoogleLogin = async () => {
    try {
      const response = await fetch("/api/auth/google/url");
      if (!response.ok) throw new Error("Failed to get auth URL");
      const { url } = await response.json();

      const width = 600;
      const height = 700;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;
      
      const popup = window.open(
        url,
        "google_oauth",
        `width=${width},height=${height},top=${top},left=${left}`
      );

      if (!popup) {
        alert("Please allow popups to login with Google");
        return;
      }

      const handleMessage = (event: MessageEvent) => {
        if (event.data?.type === "GOOGLE_AUTH_SUCCESS" && event.data.token) {
          setToken(event.data.token);
          setStep(2); 
          window.removeEventListener("message", handleMessage);
        }
      };

      window.addEventListener("message", handleMessage);
    } catch (err) {
      console.error("Login failed:", err);
      setError("Failed to initiate Google login");
    }
  };

  const saveToHistory = (url: string) => {
    if (!provider) return;
    
    const newRecord: DeploymentRecord = {
      id: Date.now().toString(),
      provider,
      name: repoName,
      url,
      date: new Date().toISOString()
    };
    
    const newHistory = [newRecord, ...history].slice(0, 50); // Keep last 50
    setHistory(newHistory);
    localStorage.setItem("deployHistory", JSON.stringify(newHistory));
  };

  // Token Persistence Effect
  useEffect(() => {
    const savedToken = localStorage.getItem("deployToken");
    if (savedToken) {
      setToken(savedToken);
      setRememberToken(true);
    }
  }, []);

  const handleTokenChange = (newToken: string) => {
    setToken(newToken);
    if (rememberToken) {
      localStorage.setItem("deployToken", newToken);
    }
  };

  const handleRememberTokenChange = (checked: boolean) => {
    setRememberToken(checked);
    if (checked) {
      localStorage.setItem("deployToken", token);
    } else {
      localStorage.removeItem("deployToken");
    }
  };

  useEffect(() => {
    if (step === 5) {
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 }
      });
    }
  }, [step]);

  useEffect(() => {
    if (analysis && repoName) {
      generateAutoFixes(analysis, repoName).then(setPatches);
    } else {
      setPatches([]);
    }
  }, [analysis, repoName]);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    setValidationError(null);
    setFile(null);
    setAnalysis(null);

    if (acceptedFiles.length > 0) {
      let fileToAnalyze: File;

      // Check if it's a folder drop (multiple files) or a single non-zip file
      if (acceptedFiles.length > 1 || !acceptedFiles[0].name.endsWith(".zip")) {
        try {
          // Create a zip from the dropped files
          const zip = new JSZip();
          
          acceptedFiles.forEach(file => {
            // Use webkitRelativePath if available (folder drop), otherwise just name
            const path = file.webkitRelativePath || file.name;
            zip.file(path, file);
          });

          const zipBlob = await zip.generateAsync({ type: "blob" });
          fileToAnalyze = new File([zipBlob], "project.zip", { type: "application/zip" });
        } catch (err) {
          console.error(err);
          setValidationError("Failed to zip files.");
          return;
        }
      } else {
        fileToAnalyze = acceptedFiles[0];
      }

      if (!fileToAnalyze.name.endsWith(".zip")) {
        setValidationError("Please upload a valid .zip file or a folder.");
        return;
      }

      try {
        const result = await analyzeZip(fileToAnalyze);
        
        if (result.projectType === "Unknown") {
           const hasIndex = result.files.some(f => f.path === "index.html" || f.path.match(/^[^/]+\/index\.html$/));
           const hasPackage = result.files.some(f => f.path === "package.json" || f.path.match(/^[^/]+\/package\.json$/));
           
           if (!hasIndex && !hasPackage) {
             setValidationError("Invalid Project: Must contain 'index.html' or 'package.json' at the root.");
             return;
           }
        }

        setAnalysis(result);
        setFile(fileToAnalyze);
      } catch (err) {
        console.error(err);
        setValidationError("Failed to read or analyze files.");
      }
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop,
    // accept: { 'application/zip': ['.zip'] }, // Removed to allow any file type for multi-file drop
    maxFiles: undefined, // Allow multiple files
    multiple: true
  } as any);

  const handleDeploy = async () => {
    if (!file || !token || !repoName || !analysis || !provider) return;

    setStep(4);
    setIsDeploying(true);
    setLogs([]);
    setError(null);

    try {
      let url = "";
      if (provider === "github") {
        url = await deployZipToGitHub(
          token,
          repoName,
          description,
          isPrivate,
          analysis,
          (status) => {
            setLogs((prev) => [...prev, status]);
          },
          customDomain,
          patches
        );
      } else {
        url = await deployZipToFirebase(
          token,
          repoName, // Using repoName state as Site ID
          analysis,
          (status) => {
            setLogs((prev) => [...prev, status]);
          }
        );
      }
      setDeployedUrl(url);
      saveToHistory(url);
      setStep(5);
    } catch (err: any) {
      setError(err.message || "Deployment failed");
      setLogs((prev) => [...prev, { step: "Failed", details: err.message, type: "error" }]);
    } finally {
      setIsDeploying(false);
    }
  };

  const handleFixPaths = async () => {
    if (!analysis) return;
    try {
      const fixedAnalysis = await fixAbsolutePaths(analysis);
      setAnalysis(fixedAnalysis);
      // Show toast or feedback? For now just update state.
    } catch (e) {
      console.error("Failed to fix paths", e);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans py-12 px-4 sm:px-6 lg:px-8">
      <HistoryModal isOpen={showHistory} onClose={() => setShowHistory(false)} history={history} />
      <PreviewModal isOpen={showPreview} onClose={() => setShowPreview(false)} analysis={analysis} />
      
      <div className="max-w-3xl mx-auto mb-12 relative">
        <button 
          onClick={() => setShowHistory(true)}
          className="absolute right-0 top-0 p-2 text-gray-500 hover:text-black hover:bg-gray-200 rounded-full transition-colors"
          title="View History"
        >
          <History className="w-6 h-6" />
        </button>

        <div className="text-center">
          <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl mb-4">
            Zip to Repo
          </h1>
          <p className="text-lg text-gray-600">
            Deploy your project to GitHub in seconds. Just upload a ZIP.
          </p>
        </div>
      </div>

      <StepIndicator currentStep={step} provider={provider} />

      <AnimatePresence mode="wait">
        {step === 0 && (
          <Card key="step0">
            <div className="flex flex-col items-center mb-6">
              <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                <Globe className="w-6 h-6" />
              </div>
              <h2 className="text-xl font-semibold">Select Provider</h2>
              <p className="text-sm text-gray-500 mt-1">Where do you want to deploy?</p>
            </div>

            <div className="grid grid-cols-1 gap-4">
              <button
                onClick={() => { setProvider("github"); setStep(1); }}
                className="flex items-center p-4 border border-gray-200 rounded-xl hover:border-black hover:bg-gray-50 transition-all group"
              >
                <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center mr-4 group-hover:bg-white group-hover:shadow-sm">
                  <Github className="w-5 h-5" />
                </div>
                <div className="text-left">
                  <h3 className="font-semibold">GitHub Pages</h3>
                  <p className="text-xs text-gray-500">Create repo & push code</p>
                </div>
                <ArrowRight className="w-4 h-4 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>

              <button
                onClick={() => { setProvider("firebase"); setStep(1); }}
                className="flex items-center p-4 border border-gray-200 rounded-xl hover:border-orange-500 hover:bg-orange-50 transition-all group"
              >
                <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center mr-4 group-hover:bg-white group-hover:shadow-sm">
                  <Flame className="w-5 h-5 text-orange-600" />
                </div>
                <div className="text-left">
                  <h3 className="font-semibold">Firebase Hosting</h3>
                  <p className="text-xs text-gray-500">Deploy to existing project</p>
                </div>
                <ArrowRight className="w-4 h-4 ml-auto opacity-0 group-hover:opacity-100 transition-opacity text-orange-600" />
              </button>
            </div>
          </Card>
        )}

        {step === 1 && (
          <Card key="step1">
            <div className="flex flex-col items-center mb-6">
              <div className={cn("w-12 h-12 rounded-full flex items-center justify-center mb-4", provider === "firebase" ? "bg-orange-100 text-orange-600" : "bg-gray-100")}>
                {provider === "firebase" ? <Flame className="w-6 h-6" /> : <Github className="w-6 h-6" />}
              </div>
              <h2 className="text-xl font-semibold">Connect {provider === "firebase" ? "Firebase" : "GitHub"}</h2>
              <p className="text-sm text-gray-500 mt-1">
                Enter your {provider === "firebase" ? "Access Token" : "Personal Access Token"}
              </p>
            </div>
            
            <Input
              label={provider === "firebase" ? "Google Access Token" : "Personal Access Token"}
              value={token}
              onChange={(e) => handleTokenChange(e.target.value)}
              type="password"
              placeholder={provider === "firebase" ? "ya29..." : "ghp_..."}
              helperText={
                provider === "firebase" ? (
                  <span>
                    Run <code>gcloud auth print-access-token</code> in your terminal to generate a temporary token.
                  </span>
                ) : (
                  <span>
                    Create a token with <code>repo</code> scope at{" "}
                    <a 
                      href="https://github.com/settings/tokens" 
                      target="_blank" 
                      rel="noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      GitHub Settings
                    </a>
                  </span>
                )
              }
            />

            {provider === "github" && (
              <div className="mt-4 mb-2">
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-gray-200"></div>
                  </div>
                  <div className="relative flex justify-center text-sm">
                    <span className="px-2 bg-white text-gray-500">Or login directly</span>
                  </div>
                </div>

                <button
                  onClick={handleGithubLogin}
                  className="w-full mt-3 flex items-center justify-center gap-2 px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium text-gray-700"
                >
                  <Github className="w-5 h-5" />
                  Login with GitHub
                </button>
              </div>
            )}

            {provider === "firebase" && (
              <div className="mt-4 mb-2">
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-gray-200"></div>
                  </div>
                  <div className="relative flex justify-center text-sm">
                    <span className="px-2 bg-white text-gray-500">Or login directly</span>
                  </div>
                </div>

                <button
                  onClick={handleGoogleLogin}
                  className="w-full mt-3 flex items-center justify-center gap-2 px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium text-gray-700"
                >
                  <Flame className="w-5 h-5 text-orange-600" />
                  Login with Google
                </button>
              </div>
            )}

            <div className="flex items-center mb-4 mt-2">
              <input
                id="remember-token"
                type="checkbox"
                checked={rememberToken}
                onChange={(e) => handleRememberTokenChange(e.target.checked)}
                className="h-4 w-4 text-black focus:ring-black border-gray-300 rounded"
              />
              <label htmlFor="remember-token" className="ml-2 block text-sm text-gray-700">
                Remember my token
              </label>
            </div>

            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => setStep(0)}>Back</Button>
              <Button 
                onClick={() => setStep(2)} 
                disabled={!token}
                className={provider === "firebase" ? "bg-orange-600 hover:bg-orange-700" : ""}
              >
                Next Step <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </Card>
        )}

        {step === 2 && (
          <Card key="step2">
            <div className="flex flex-col items-center mb-6">
              <div className={cn("w-12 h-12 rounded-full flex items-center justify-center mb-4", provider === "firebase" ? "bg-orange-100 text-orange-600" : "bg-gray-100")}>
                {provider === "firebase" ? <Globe className="w-6 h-6" /> : <FolderGit2 className="w-6 h-6" />}
              </div>
              <h2 className="text-xl font-semibold">
                {provider === "firebase" ? "Target Site" : "Repository Details"}
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                {provider === "firebase" ? "Which Firebase site to deploy to?" : "Where should we push your code?"}
              </p>
            </div>

            <Input
              label={provider === "firebase" ? "Site ID / Project ID" : "Repository Name"}
              value={repoName}
              onChange={(e) => setRepoName(e.target.value)}
              placeholder={provider === "firebase" ? "my-project-id" : "my-awesome-project"}
              helperText={provider === "firebase" ? "The ID of the Firebase project or site." : undefined}
            />
            
            {provider === "github" && (
              <>
                <Input
                  label="Description (Optional)"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="A brief description of your project"
                />

                <Input
                  label="Custom Domain (Optional)"
                  value={customDomain}
                  onChange={(e) => setCustomDomain(e.target.value)}
                  placeholder="example.com"
                  helperText="We'll add a CNAME file to your repo automatically."
                />

                <div className="flex items-center mb-6">
                  <input
                    id="private-repo"
                    type="checkbox"
                    checked={isPrivate}
                    onChange={(e) => setIsPrivate(e.target.checked)}
                    className="h-4 w-4 text-black focus:ring-black border-gray-300 rounded"
                  />
                  <label htmlFor="private-repo" className="ml-2 block text-sm text-gray-900">
                    Make this repository private
                  </label>
                </div>
              </>
            )}

            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => setStep(1)}>Back</Button>
              <Button 
                onClick={() => setStep(3)} 
                disabled={!repoName}
                className={provider === "firebase" ? "bg-orange-600 hover:bg-orange-700" : ""}
              >
                Next Step <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </Card>
        )}

        {step === 3 && (
          <Card key="step3">
            <div className="flex flex-col items-center mb-6">
              <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                <FileArchive className="w-6 h-6" />
              </div>
              <h2 className="text-xl font-semibold">Upload Project</h2>
              <p className="text-sm text-gray-500 mt-1">Upload your project as a .zip file</p>
            </div>

            <div
              {...getRootProps()}
              className={cn(
                "border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors mb-6",
                isDragActive ? "border-black bg-gray-50" : "border-gray-200 hover:border-gray-300",
                file ? "bg-green-50 border-green-200" : ""
              )}
            >
              <input {...getInputProps()} />
              {file ? (
                <div className="flex flex-col items-center text-green-700">
                  <CheckCircle className="w-8 h-8 mb-2" />
                  <p className="font-medium">{file.name}</p>
                  <p className="text-xs mt-1">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
              ) : (
                <div className="flex flex-col items-center text-gray-500">
                  <FolderInput className="w-8 h-8 mb-2" />
                  <p className="font-medium">Drag & drop ZIP or Folder here</p>
                  <p className="text-xs mt-1">or click to browse</p>
                </div>
              )}
            </div>

            {validationError && (
              <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-xl flex items-start gap-3 text-sm">
                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">Validation Error</p>
                  <p>{validationError}</p>
                </div>
              </div>
            )}

            {analysis && (
              <div className="mb-6 bg-gray-50 rounded-xl p-4 border border-gray-100">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                    <FileCode className="w-4 h-4" /> Analysis Result
                  </h3>
                  <button 
                    onClick={() => setShowPreview(true)}
                    className="text-xs flex items-center gap-1 text-blue-600 hover:text-blue-800 font-medium"
                  >
                    <Eye className="w-3 h-3" /> Preview Index
                  </button>
                </div>

                {analysis.warnings && analysis.warnings.length > 0 && (
                  <div className="mb-4 p-3 bg-yellow-50 border border-yellow-100 rounded-lg">
                    <h4 className="text-xs font-bold text-yellow-800 flex items-center gap-1.5 mb-1">
                      <AlertTriangle className="w-3.5 h-3.5" /> Potential Issues Detected
                    </h4>
                    <ul className="list-disc list-inside text-xs text-yellow-700 space-y-0.5 mb-2">
                      {analysis.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                    
                    {analysis.warnings.some(w => w.includes("Absolute paths")) && (
                      <button 
                        onClick={handleFixPaths}
                        className="text-xs bg-yellow-100 hover:bg-yellow-200 text-yellow-800 px-2 py-1 rounded-md flex items-center gap-1 transition-colors font-medium"
                      >
                        <Wand2 className="w-3 h-3" /> Auto-Fix Absolute Paths
                      </button>
                    )}
                  </div>
                )}

                {analysis.ignoredFiles && analysis.ignoredFiles.length > 0 && (
                  <div className="mb-4 p-3 bg-gray-100 border border-gray-200 rounded-lg">
                    <h4 className="text-xs font-bold text-gray-700 flex items-center gap-1.5 mb-1">
                      <Trash2 className="w-3.5 h-3.5" /> {analysis.ignoredFiles.length} Junk Files Removed
                    </h4>
                    <p className="text-[10px] text-gray-500 mb-2">These files will NOT be deployed to keep your repo clean.</p>
                    <div className="max-h-20 overflow-y-auto space-y-0.5">
                      {analysis.ignoredFiles.map((f, i) => (
                        <div key={i} className="flex justify-between text-[10px] text-gray-500">
                           <span className="truncate max-w-[200px]">{f.path}</span>
                           <span className="text-gray-400 italic">{f.reason}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {patches.length > 0 && (
                  <div className="mb-4 p-3 bg-blue-50 border border-blue-100 rounded-lg">
                    <h4 className="text-xs font-bold text-blue-800 flex items-center gap-1.5 mb-1">
                      <Hammer className="w-3.5 h-3.5" /> Auto-Fixes Ready
                    </h4>
                    <p className="text-[10px] text-blue-600 mb-2">We will automatically apply these fixes during deployment:</p>
                    <div className="space-y-1">
                      {patches.map((p, i) => (
                        <div key={i} className="flex items-start gap-2 text-[10px] text-blue-700 bg-blue-100/50 p-1.5 rounded">
                           <CheckCircle2 className="w-3 h-3 mt-0.5 shrink-0" />
                           <div>
                             <span className="font-semibold block">{p.path}</span>
                             <span className="opacity-80">{p.description}</span>
                           </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="bg-white p-3 rounded-lg border border-gray-100 shadow-sm">
                    <p className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                      <Settings2 className="w-3 h-3" /> Framework Preset
                    </p>
                    <p className="font-semibold text-sm">{analysis.frameworkPreset}</p>
                  </div>
                  <div className="bg-white p-3 rounded-lg border border-gray-100 shadow-sm">
                    <p className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                      <Terminal className="w-3 h-3" /> Build Command
                    </p>
                    <p className="font-mono text-xs bg-gray-50 px-1.5 py-0.5 rounded inline-block border border-gray-200">
                      {analysis.buildCommand}
                    </p>
                  </div>
                  <div className="bg-white p-3 rounded-lg border border-gray-100 shadow-sm">
                    <p className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                      <Box className="w-3 h-3" /> Output Directory
                    </p>
                    <p className="font-mono text-xs bg-gray-50 px-1.5 py-0.5 rounded inline-block border border-gray-200">
                      {analysis.outputDir}
                    </p>
                  </div>
                  <div className="bg-white p-3 rounded-lg border border-gray-100 shadow-sm">
                    <p className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                      <FileIcon className="w-3 h-3" /> Total Files
                    </p>
                    <p className="font-semibold text-sm">{analysis.fileCount}</p>
                  </div>
                </div>
                
                <div className="bg-white rounded-lg border border-gray-100 shadow-sm overflow-hidden">
                  <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 text-xs font-medium text-gray-500">
                    File Structure Preview
                  </div>
                  <div className="max-h-48 overflow-y-auto p-2">
                    {(() => {
                      const tree = buildTree(analysis.files);
                      return tree.map(node => (
                        <FileTreeNode key={node.path} node={node} />
                      ));
                    })()}
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => setStep(2)}>Back</Button>
              <Button 
                onClick={handleDeploy} 
                disabled={!file}
                className={provider === "firebase" ? "bg-orange-600 hover:bg-orange-700" : ""}
              >
                Deploy to {provider === "firebase" ? "Firebase" : "GitHub"} <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </Card>
        )}

        {(step === 4 || step === 5) && (
          <Card key="step4" className="max-w-xl">
            <div className="flex flex-col items-center mb-6">
              {step === 5 ? (
                <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-4">
                  <CheckCircle className="w-8 h-8" />
                </div>
              ) : (
                <div className={cn("w-16 h-16 rounded-full flex items-center justify-center mb-4", provider === "firebase" ? "bg-orange-50 text-orange-600" : "bg-blue-50 text-blue-600")}>
                  <Loader2 className="w-8 h-8 animate-spin" />
                </div>
              )}
              <h2 className="text-xl font-semibold">
                {step === 5 ? "Deployment Successful!" : "Deploying..."}
              </h2>
              {step === 5 && deployedUrl && (
                <div className="flex flex-col items-center">
                  <div className="flex items-center gap-2 mt-2">
                    <a 
                      href={deployedUrl} 
                      target="_blank" 
                      rel="noreferrer"
                      className="text-blue-600 hover:underline font-medium text-lg"
                    >
                      View {provider === "firebase" ? "Site" : "Repository"}
                    </a>
                    <CopyButton text={deployedUrl} />
                  </div>
                  
                  {provider === "github" && (
                    <p className="text-xs text-gray-500 mt-4 max-w-xs text-center">
                      Your site should be live shortly! If it's a 404, wait a minute or check the <strong>Actions</strong> tab in your repo.
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="bg-gray-900 rounded-xl p-4 font-mono text-xs text-gray-300 h-64 overflow-y-auto space-y-2 shadow-inner">
              {logs.map((log, i) => (
                <div key={i} className="mb-2">
                  <div className={cn(
                    "flex gap-2",
                    log.type === "error" ? "text-red-400" : 
                    log.type === "success" ? "text-green-400" : "text-gray-300"
                  )}>
                    <span className="opacity-50 flex-shrink-0">[{new Date().toLocaleTimeString()}]</span>
                    <span>
                      {log.step}
                      {log.details && (
                        <span className="block ml-4 opacity-70 mt-1 break-all">{log.details}</span>
                      )}
                    </span>
                  </div>
                  {log.progress !== undefined && <ProgressBar progress={log.progress} />}
                </div>
              ))}
              {logs.length === 0 && <span className="opacity-50">Waiting for logs...</span>}
              {isDeploying && logs.length > 0 && logs[logs.length - 1].progress === undefined && (
                <div className="animate-pulse text-gray-500 ml-2">...</div>
              )}
              <div ref={logsEndRef} />
            </div>
            
            {step === 5 && (
              <Button onClick={() => { setStep(0); setProvider(null); setLogs([]); setFile(null); }} className="mt-6">
                Deploy Another
              </Button>
            )}
            
            {error && (
               <Button onClick={() => setStep(3)} variant="secondary" className="mt-6 bg-red-50 text-red-600 hover:bg-red-100">
                 Try Again
               </Button>
            )}
          </Card>
        )}
      </AnimatePresence>
    </div>
  );
}
